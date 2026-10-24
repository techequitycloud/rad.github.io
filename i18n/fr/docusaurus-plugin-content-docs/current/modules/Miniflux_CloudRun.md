---
title: "Miniflux sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Miniflux sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Miniflux_CloudRun.md @ e69407af sha256:c984b6c3f06d -->

# Miniflux sur Google Cloud Run {#miniflux-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Miniflux_CloudRun.png" alt="Miniflux sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un
binaire Go statique unique qui stocke tout son état dans PostgreSQL. Ce module
déploie Miniflux sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Miniflux et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Miniflux sur RAD, et comment cela se compare {#what-miniflux-costs-on-rad-and-how-that-compares}

**L'exécution de Miniflux dans votre propre projet GCP coûte environ 167,44 $/mois en frais Google Cloud ; les frais de module de RAD sont de 175 crédits uniques (ou 157,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure toutes les heures en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide GKE pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~167,44 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~77 crédits/jour, mesuré toutes les heures par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | 110,42 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **167,44 $** |

### Comment cela se compare {#how-it-compares}

- L'instance hébergée officielle du projet coûte **15 $/an** (environ 1,25 $/mois) (source : https://miniflux.app/#pricing), gérée par le projet lui-même sans infrastructure à exploiter — la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit d'un lecteur de flux mono-utilisateur, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la suppression logique récupérable de 30 jours de Google.
Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL,
aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
plus jamais les frais de module. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour
lequel RAD ne gère que la facturation), vous devez le restaurer vous-même dans
les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre
solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits
pour le palier sandbox que la plupart des utilisations d'étude/démo
correspondent). Google indique que la plupart des services fonctionnent à
nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de la supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Miniflux
purement et simplement et de le redéployer plus tard. Un redéploiement coûte
à nouveau les frais de module, plus les builds — environ 175 + 3-6 crédits de
temps de build.

La suppression ne permet d'économiser de l'argent que si Miniflux restait
inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport
à son propre coût d'exécution quotidien — par rapport au total du projet
ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût
d'exécution ici est généralement la base de données ; elle ne s'arrête que
lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette
application pendant que quelque chose d'autre partage le projet n'économise que
la partie calcul de cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ;
https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les
mécanismes de pause/restauration ; https://miniflux.app/#pricing pour le prix
du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Miniflux s'exécute comme un conteneur Go unique sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 2 vCPU / 4 GiB par défaut, CPU toujours alloué avec `min = 1` pour le poller de flux intégré |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Miniflux stocke **tout** l'état ici ; pas de MySQL/autre moteur |
| Stockage d'objets | Cloud Storage | Un bucket `data` par défaut est provisionné mais non monté/utilisé par l'application (tout l'état réside dans PostgreSQL) ; un montage NFS optionnel est également disponible mais inutilisé par défaut |
| Cache et file d'attente | Aucun | Miniflux n'a pas de dépendance Redis et pas de worker séparé |
| Secrets | Secret Manager | `ADMIN_PASSWORD` auto-généré (propriétaire initial) ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  interrompt le démarrage.
- **Le poller de flux s'exécute en interne.** Miniflux n'a pas de worker
  séparé — le même conteneur sert l'interface utilisateur et rafraîchit les
  flux sur `POLLING_FREQUENCY`. Pour cette raison, `cpu_always_allocated = true` et `min_instance_count = 1` sont les
  valeurs par défaut : la facturation basée sur les requêtes étranglerait le
  poller à ~0 CPU au repos et bloquerait les rafraîchissements. Pour une mise à
  l'échelle à zéro, basculez `cpu_always_allocated = false` + `min = 0` et externalisez le
  polling via un appel Cloud Scheduler à `/v1/feeds/refresh`.
- **Le propriétaire initial est pré-rempli, pas auto-enregistré.** `CREATE_ADMIN = 1`
  initialise le compte `admin` à partir du secret `ADMIN_PASSWORD` au premier
  démarrage ; l'inscription en libre-service reste désactivée. Récupérez le mot
  de passe de Secret Manager pour vous connecter.
- **Les migrations de schéma s'exécutent au démarrage** (`RUN_MIGRATIONS = 1`) — il n'y a
  pas de job de migration séparé, donc la mise à niveau de la version applique
  automatiquement les modifications de schéma.
- **Pas de Redis.** `enable_redis = false` — Miniflux conserve chaque flux, entrée et
  session dans PostgreSQL. Laissez-le désactivé.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que l'interface web (et les
  propres API de Miniflux / Fever / Google Reader) soient accessibles.
  L'activation d'IAP placera l'interface utilisateur derrière la connexion
  Google.
- **`DATABASE_URL` est composé à l'exécution** par le point d'entrée du conteneur
  (format clé/valeur libpq), se ramifiant sur socket vs loopback vs TCP IP
  privée afin que la même image fonctionne sur Cloud Run et GKE.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Miniflux {#a-cloud-run--the-miniflux-service}

Miniflux s'exécute comme un service Cloud Run v2 écoutant sur le port
**8080**. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs. Comme le poller de flux
s'exécute dans le conteneur, le CPU est alloué en permanence et au moins une
instance est maintenue chaude.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~miniflux"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Miniflux stocke **toutes** les données de l'application (flux, entrées,
utilisateurs, sessions, catégories) dans une instance Cloud SQL pour PostgreSQL
15 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur
un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement,
le job `db-init` crée la base de données et le rôle `miniflux` et installe
l'extension `hstore` appartenant au rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage / NFS {#c-cloud-storage--nfs}

Miniflux n'a **pas** besoin de stockage d'objets — il conserve tout son état
dans PostgreSQL. La valeur par défaut `storage_buckets` de la variante provisionne
toujours un bucket Cloud Storage `data` (boilerplate d'échafaudage), mais
il n'est pas monté ou référencé par l'application ; remplacez `storage_buckets = []` pour
ignorer sa création. NFS est désactivé par défaut (`enable_nfs = false`) : Miniflux
lie les pièces jointes plutôt que de les télécharger, il n'a donc pas de
stockage de pièces jointes et n'a pas besoin de système de fichiers partagé.

- **Console :** Filestore → Instances (si NFS est activé) ; Cloud Storage →
  Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : `ADMIN_PASSWORD` — le mot de passe du
propriétaire initial injecté dans Miniflux au premier démarrage. Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (ingress public). Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être superposé ; les paramètres d'ingress et le contrôle
d'égresse VPC contrôlent la connectivité. Lorsqu'un domaine personnalisé est
utilisé, définissez `BASE_URL` afin que Miniflux émette des liens absolus et
des URL de proxy de flux corrects.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications
de disponibilité et des politiques d'alerte optionnelles. Le point d'entrée
enregistre son mode de connexion `DATABASE_URL` (socket / loopback / TCP IP
privée) au démarrage — utile pour diagnostiquer la connectivité de la base de
données.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Miniflux {#3-miniflux-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte
  via le Cloud SQL Auth Proxy et crée de manière idempotente la base de données
  et le rôle `miniflux`, accorde les privilèges, réattribue le schéma
  `public` et installe l'extension `hstore` **appartenant au rôle de
  l'application** (afin que la migration Miniflux `v119`, qui supprime
  `hstore`, réussisse). Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée définit
  `RUN_MIGRATIONS=1`, de sorte que Miniflux applique ses propres migrations de schéma
  à chaque démarrage — pas d'étape de migration séparée. Prévoyez un temps
  supplémentaire au premier démarrage pour la construction initiale du schéma.
- **Le propriétaire initial est pré-rempli.** `CREATE_ADMIN=1` initialise le
  compte `admin` (`ADMIN_USERNAME`) à partir du secret `ADMIN_PASSWORD`. C'est
  idempotent — les démarrages ultérieurs enregistrent "l'utilisateur existe
  déjà". Récupérez le mot de passe pour vous connecter :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Chemin de santé.** Les valeurs par défaut `startup_probe`/`liveness_probe` de la
  variante ciblent `/` (racine), et non le propre point de terminaison
  `/healthcheck` de l'application — les deux renvoient un `200 OK` non
  authentifié. Ne pointez pas les sondes vers des pages authentifiées.
- **Le poller de flux est intégré.** Les flux se rafraîchissent sur
  `POLLING_FREQUENCY` à l'intérieur du même conteneur. Avec les valeurs par défaut
  `cpu_always_allocated = true` + `min = 1`, le polling s'exécute en continu. Si vous
  passez à la mise à l'échelle à zéro, les flux ne se rafraîchiront pas
  lorsque le service est inactif, sauf si vous pilotez `/v1/feeds/refresh` depuis Cloud
  Scheduler.
- **`BASE_URL` pilote les liens absolus.** Il utilise par défaut le
  `CLOUDRUN_SERVICE_URL` injecté. Définissez-le explicitement (via `environment_variables`) sur
  l'URL du domaine personnalisé lorsque vous placez le service derrière un
  équilibreur de charge.
- **Inspectez l'exécution du job db-init :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Miniflux sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `miniflux` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Miniflux` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image Miniflux (`FROM miniflux/miniflux:<tag>`). Épinglez à une version (par exemple `2.2.15`) en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué pour le poller de flux intégré. Passez à `false` uniquement avec `min = 0` + polling externalisé. |
| `min_instance_count` | `1` | `1` maintient le poller de flux en cours d'exécution entre les requêtes ; `0` (mise à l'échelle à zéro) arrête le polling en arrière-plan sauf s'il est externalisé. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. Miniflux est un processus unique ; les instances supplémentaires partagent simplement la charge des requêtes. |
| `container_port` | `8080` | Miniflux écoute sur 8080 (`LISTEN_ADDR`). |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Miniflux dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` maintient l'interface utilisateur/API publiquement accessible. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Miniflux. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés dans le conteneur (par exemple `BASE_URL`, `POLLING_FREQUENCY`, `DISABLE_LOCAL_AUTH`). Ne pas définir `PORT` (réservé) ou `DATABASE_URL` (composé à l'exécution). |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_file`, `backup_format` — sauvegarde Cloud SQL automatisée et restauration au
déploiement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{name_suffix="data", location=""}]` | Le bucket `data` par défaut est provisionné mais inutilisé/non monté par Miniflux — remplacez par `[]` pour l'ignorer. |
| `enable_nfs` | `false` | Provisionne un montage NFS Filestore à `/opt/miniflux/storage`. Laissez désactivé — Miniflux stocke tout l'état dans PostgreSQL. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Miniflux nécessite PostgreSQL. |
| `db_name` | `miniflux` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `miniflux` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (rôle/base de données/`hstore`). |
| `cron_jobs` | `[]` | Jobs planifiés optionnels (par exemple, un appel Cloud Scheduler `/v1/feeds/refresh` lorsque mis à l'échelle à zéro). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 60s, 30 échecs | Sonde de démarrage. Fenêtre généreuse pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60s, période de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring par rapport au point de terminaison public ; activez et définissez un chemin pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux n'utilise pas Redis — laissez désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Inutilisé par Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et audit logging {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` — voir
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application (`miniflux`). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut, sauf s'il est remplacé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — une
> configuration IAP sans identités autorisées, un runtime `gen1` avec des
> montages NFS/GCS, un `database_type` qui ne correspond pas à une extension
> activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Miniflux ne prend en charge que PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `db_name` / `db_user` | Définir une fois (`miniflux`) | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les flux et entrées. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans source de sauvegarde valide échoue le job d'importation. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer de Secret Manager | Élevé | C'est la seule information d'identification du propriétaire injectée au premier démarrage ; sans elle, vous ne pouvez pas vous connecter tant que vous ne la réinitialisez pas dans la base de données. |
| `cpu_always_allocated` + `min_instance_count` | `true` + `1` | Élevé | La définition de `false`/`0` sans polling externalisé arrête le rafraîchissement des flux lorsque le service est inactif. |
| `enable_redis` | `false` | Moyen | Redis est inutilisé ; l'activer gaspille des ressources et ne change rien. |
| `ingress_settings` | `all` | Élevé | `internal` bloque l'interface utilisateur publique et les clients de lecture de flux externes (Fever / Google Reader API). |
| `enable_iap` | désactivé sauf si l'interface utilisateur doit être protégée | Moyen | IAP place l'interface utilisateur/API derrière la connexion Google, bloquant les clients API Fever/Reader qui s'authentifient avec des jetons d'application. |
| `BASE_URL` (env) | URL publique réelle | Moyen | Une URL de base obsolète/incorrecte génère des liens absolus et des URL d'image proxy de flux cassés. |
| `startup_probe.path` | `/` (par défaut) | Élevé | Pointer la sonde vers une page authentifiée renvoie 401/403 et la révision ne devient jamais prête. |
| `memory_limit` | `4Gi` (plancher ≥512Mi) | Moyen | En dessous du plancher de 512Mi de gen2, l'apply est rejeté ; Miniflux lui-même est léger. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Miniflux partagée avec la variante GKE est décrite
dans **[Miniflux_Common](Miniflux_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Miniflux sur Cloud Run](../labs/Miniflux_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [Miniflux sur GKE Autopilot](Miniflux_GKE.md) — la même application sur
  Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Miniflux Common — Configuration d'application partagée](Miniflux_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
