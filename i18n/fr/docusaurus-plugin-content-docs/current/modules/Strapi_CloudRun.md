---
title: "Strapi sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Strapi sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Strapi_CloudRun.md @ e69407af sha256:1afcfbd9b42c -->

# Strapi sur Google Cloud Run {#strapi-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Strapi_CloudRun.png" alt="Strapi sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Strapi est le principal CMS headless open source, offrant une API de contenu
entièrement personnalisable (REST et GraphQL) avec un panneau d'administration
riche, utilisé par les entreprises et les développeurs du monde entier pour la
gestion de contenu et les architectures API-first. Ce module déploie Strapi sur
**Cloud Run v2** sur la base du module [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Strapi et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de base App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Strapi sur RAD, et comment cela se compare {#what-strapi-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Strapi sur RAD coûte environ 98,82 $ US par mois dans
un projet Google Cloud que vous possédez, avec les frais de module facturés une
seule fois en crédits RAD.** Strapi a besoin de sa propre base de données et
d'un petit serveur de fichiers partagé pour les téléchargements, de sorte que la
plupart des coûts d'exploitation sont liés à l'infrastructure plutôt qu'au
processus CMS lui-même. Pour le coût le plus bas, cela reste sur Cloud Run ; GKE
Autopilot ne vaut la peine que s'il doit être placé à côté d'autres charges de
travail Kubernetes — voir le [guide GKE](Strapi_GKE.md) pour cette option, à
environ 104,74 $ US par mois à la place. Si vous n'avez besoin de Strapi
qu'occasionnellement — un projet de contenu entre deux lancements, un site
client en cours d'évaluation — un projet géré par RAD peut être supprimé et
restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu
de payer pour qu'il reste inactif. Voir **Mettre en pause gratuitement**,
ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont
énumérées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3 à 6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **98,82 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte
qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (scaleToZero) | 28,37 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **98,82 $ US** |

### Comment cela se compare {#how-it-compares}

- Le plan hébergé de Strapi, **Strapi Cloud**, commence à **35 $/mois** (Starter
  : 100 000 requêtes API, 50 Go de stockage/bande passante), et monte à
  **90 $/mois** (Pro) et **450 $/mois** (Business) pour plus de requêtes et de
  stockage (source : [strapi.io/pricing-cloud](https://strapi.io/pricing-cloud)).
  Le chiffre de RAD pour un projet propre est supérieur au prix affiché du plan
  Starter, mais il inclut le CMS headless plus une instance PostgreSQL dédiée,
  un partage NFS et un réseau que vous contrôlez directement, plutôt qu'un
  environnement Strapi géré avec une facturation à l'usage.
- Une comparaison autogérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24
  $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois,
  et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois
  — moins cher en termes de trésorerie, mais aucun n'inclut une base de données
  gérée, des sauvegardes ou TLS, que vous devriez exécuter et patcher vous-même.
- La majeure partie du coût d'exécution du projet propre de RAD ici est la base
  de données et le serveur de fichiers NFS, et non le conteneur propre de Strapi
  — les mêmes ressources dont toute implémentation CMS sérieuse a besoin, gérées
  plutôt qu'auto-administrées.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Strapi s'exécute dans un projet géré par RAD pour vous, la suppression de
l'ensemble du projet délie d'abord sa facturation, puis demande à Google de
supprimer purement et simplement le projet — la suppression logicielle
récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit pas Cloud SQL, la VM NFS ou la ressource de calcul une par une
: l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il
attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Étant donné que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— il s'agit d'une vérification, pas d'une reconstruction, et une mise à jour ne
facture plus jamais les frais de module. Cela ne coûte qu'une poignée de
crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3
éléments.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
ne gère que la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le
palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google
indique que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé vos types de contenu ou téléchargé
des actifs que vous souhaitez conserver, copiez une sauvegarde (vers Google
Drive ou un bucket en dehors du projet) avant de supprimer. Pour une
installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours
passée, l'alternative est de supprimer Strapi purement et simplement et de le
redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus
les builds — environ 115 crédits (environ 11,50 $ US) dans votre propre projet,
ou 104 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Strapi devait rester
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution quotidien — par rapport au total du
projet propre ci-dessus (environ 3,29 $ US par jour), cela représente environ 4
jours ou plus, ou environ 4 jours ou plus dans un projet géré par RAD (32
crédits par jour). La majeure partie du coût d'exécution ici est la base de
données et le serveur de fichiers NFS ; ils ne s'arrêtent que si rien d'autre
dans le projet ne les utilise, de sorte que la suppression de Strapi alors que
quelque chose d'autre partage le projet n'économise que la partie calcul propre
à cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration ;
[strapi.io/pricing-cloud](https://strapi.io/pricing-cloud) pour les plans
hébergés de Strapi Cloud.

## 1. Vue d'ensemble {#1-overview}

Strapi s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Strapi nécessite PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Téléchargements de médias partagés entre toutes les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket de téléchargement dédié (suffixe `strapi-uploads`) |
| Cache (facultatif) | Redis / Memorystore | Facultatif ; désactivé par défaut |
| Secrets | Secret Manager | Cinq secrets cryptographiques auto-générés plus le mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL est requis.** La couche de données de Strapi est connectée à
  PostgreSQL ; MySQL et `NONE` empêchent le démarrage.
- **Une image de conteneur personnalisée est construite via Cloud Build.**
  `container_image_source` par défaut à `"custom"` — le module construit une image Node.js 20
  en deux étapes prête pour la production à chaque incrément de version.
- **Cinq secrets cryptographiques sont auto-générés.** `JWT_SECRET`, `ADMIN_JWT_SECRET`,
  `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` et `APP_KEYS` sont générés et stockés dans
  Secret Manager lors du premier déploiement et ne doivent jamais changer par la
  suite.
- **NFS est activé par défaut.** Strapi stocke les médias téléchargés sous
  `/uploads`. Sans volume NFS partagé (gen2 requis), les médias sont perdus
  entre les instances.
- **Redis est désactivé par défaut.** Activez-le uniquement lorsque vous
  utilisez des plugins qui nécessitent explicitement un cache partagé ou un
  magasin de sessions ; lorsqu'il est activé, `redis_host` doit être défini.
- **Le port du conteneur est 8080 sur Cloud Run.** Le module Cloud Run
  remplace le port par défaut 1337 de Strapi Common pour se conformer au port
  standard de Cloud Run.
- **Les variables du bucket de médias GCS sont auto-injectées.** `GCS_BUCKET_NAME` et
  `GCS_BASE_URL` sont définies automatiquement ; aucune configuration manuelle
  n'est requise.
- **La mise à l'échelle à zéro est la valeur par défaut.** `min_instance_count = 0` permet au
  service de passer à zéro lorsqu'il est inactif, bien que cela ajoute une
  latence de démarrage à froid de 15 à 30 secondes lors de la première requête.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Strapi {#a-cloud-run--the-strapi-service}

Strapi s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

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

Strapi stocke toutes les données d'application (types de contenu, contenu,
utilisateurs, jetons API) dans une instance Cloud SQL pour PostgreSQL 15 gérée.
Le service se connecte en privé via le **proxy d'authentification Cloud SQL**
sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un job
Cloud Run d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits dans un partage **Filestore (NFS)** monté
dans le service afin que toutes les instances partagent les mêmes fichiers
(environnement d'exécution gen2 requis). Un bucket **Cloud Storage** dédié
(suffixe `strapi-uploads`) est également provisionné et configuré comme fournisseur de
téléchargement GCS de Strapi.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Cinq secrets cryptographiques Strapi sont générés lors du premier déploiement et
stockés dans Secret Manager : `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`,
`TRANSFER_TOKEN_SALT` et `APP_KEYS` (quatre clés jointes par des virgules). Le mot de passe
de la base de données est également stocké ici. Tous les secrets sont injectés
dans le service au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Cache Redis (facultatif) {#e-redis-cache-optional}

Lorsque `enable_redis = true`, Redis est utilisé comme magasin de sessions et cache de
réponses d'API REST via les plugins `strapi-plugin-redis` et `strapi-plugin-rest-cache`. Lorsque
`redis_host` est laissé nul et que NFS est activé, l'IP de l'hôte NFS est utilisée
comme point de terminaison Redis au moment de l'exécution.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'ingress et de sortie VPC contrôlent
la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Strapi {#3-strapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job Cloud
  Run `db-init` s'exécute à chaque apply en utilisant `postgres:15-alpine`. Il crée de
  manière idempotente la base de données et l'utilisateur Strapi, accorde les
  privilèges nécessaires (y compris `CREATEDB`) et signale au proxy
  d'authentification Cloud SQL de s'arrêter proprement. Il peut être réexécuté
  en toute sécurité.
- **Fournisseur de médias GCS.** `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont
  automatiquement injectés dans le conteneur. Le `config/plugins.js` de Strapi détecte
  ces variables et bascule vers le fournisseur de téléchargement GCS pour tous
  les actifs de la médiathèque.
- **Livraison d'e-mails (facultatif).** Si `SMTP_HOST` est défini dans
  `environment_variables`, `config/plugins.js` active automatiquement le fournisseur d'e-mails
  `nodemailer` pour les notifications Strapi. Définissez `SMTP_PASSWORD` via
  `secret_environment_variables`.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent
  `/_health` via HTTP — le point de terminaison de santé dédié de Strapi qui
  renvoie 200 uniquement lorsque l'application et la connexion à la base de
  données sont prêtes. La sonde de démarrage (`startup_probe` — la valeur
  réellement appliquée ; `startup_probe_config` est une variable distincte et inerte)
  permet jusqu'à ~90 secondes (60 s de délai initial + 3 × 10 secondes de
  période) pour l'initialisation du premier démarrage.
- **Les secrets cryptographiques sont immuables après le premier déploiement.**
  Les cinq secrets auto-générés signent les sessions actives et les jetons API.
  La régénération de l'un d'entre eux invalide immédiatement toutes les sessions
  actives et les jetons.
- **Connexion administrateur.** Il n'y a pas d'utilisateur administrateur par
  défaut ; l'assistant de première exécution de Strapi crée l'administrateur
  initial lors de la première visite du navigateur au panneau d'administration.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Strapi sont listés ; toutes les autres entrées sont héritées de
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
| `application_name` | `strapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Strapi CMS` | Nom convivial affiché dans la console. |
| `application_description` | `Strapi CMS on Cloud Run` | Description du service. |
| `application_version` | `5.0.0` | Tag d'image ; incrémenter pour déclencher une nouvelle exécution et révision Cloud Build. Ne sélectionne **pas** la version du package Strapi — `@strapi/strapi` est épinglé dans `Strapi_Common/scripts/package.json` (actuellement `4.24.2`) et cette variable n'a aucun effet sur celle-ci. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` déclenche Cloud Build ; `"prebuilt"` déploie une URI d'image existante. |
| `container_image` | `""` | Remplace l'URI de l'image ; laisser vide pour l'image construite par le module. |
| `container_build_config` | `{ enabled = true }` | Chemin du Dockerfile, contexte de build et arguments de build pour Cloud Build. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry avant le déploiement. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; Strapi a besoin de marge pour Node.js et le panneau d'administration. |
| `min_instance_count` | `0` | Instances minimales (0 = mise à l'échelle à zéro). Définir à `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Instances maximales ; augmenter après avoir validé l'état partagé NFS. |
| `container_port` | `1337` | Port vers lequel le service Cloud Run achemine le trafic (par défaut Cloud Run). |
| `execution_environment` | `gen2` | gen2 est requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter pour le traitement de médias longs. |
| `enable_cloudsql_volume` | `true` | Sidecar du proxy d'authentification Cloud SQL pour les connexions socket. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements canary/blue-green. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions Cloud Run conserver. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (tous / interne / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager pour les secrets supplémentaires. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation Pub/Sub. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Remarque : ce module utilise `backup_file` (pas `backup_uri`). |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Équilibreur de charge, CDN et Cloud Armor {#group-10--load-balancer-cdn--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Strapi (gen2 requis). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL est requis — ne pas changer pour MySQL ou `NONE`. |
| `application_database_name` | `strapidb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `strapiuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement d'alias supplémentaires pour les détails de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[{ name="db-init", execute_on_apply=true }]` | Le job `db-init` intégré s'exécute à chaque apply. Remplacer par une liste non vide pour le remplacer. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run co-déployés (par exemple, workers en arrière-plan). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, délai initial de 60s, 3 tentatives | La sonde réellement appliquée. `startup_probe_config` est également déclarée mais est supplantée par cette valeur et n'a aucun effet. |
| `liveness_probe` | HTTP `/_health`, délai initial de 30s, 3 tentatives | La sonde réellement appliquée. `health_check_config` est également déclarée mais est supplantée par cette valeur et n'a aucun effet. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utiliser Redis pour le cache/les sessions (désactivé par défaut). |
| `redis_host` | `null` | Point de terminaison Redis. Laisser nul pour revenir à l'IP du serveur NFS (nécessite `enable_nfs = true`) ; si NFS est également désactivé, le fallback n'est pas résolu et la connexion échoue. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données (sensible). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEYS` / `JWT_SECRET` / `ADMIN_JWT_SECRET` / `API_TOKEN_SALT` (auto-généré) | généré une fois, jamais modifié | Critique | La rotation de l'un de ces éléments après le premier déploiement invalide immédiatement toutes les sessions actives et les jetons API ; chaque utilisateur est déconnecté et toutes les intégrations client sont interrompues. |
| `database_type` | `POSTGRES_15` | Critique | Strapi nécessite PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les téléchargements sont perdus entre les instances/redémarrages. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP, entraînant une recréation complète et une perte de données. |
| `application_database_name` / `application_database_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommer fait que Strapi se connecte à une base de données vide. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_file` valide échoue le job d'importation. |
| `execution_environment` | `gen2` | Élevé | gen1 ne prend pas en charge les montages NFS ; NFS échouera silencieusement. |
| `enable_redis` | `false` | Élevé | Activer uniquement lorsque les plugins l'exigent. Un `redis_host` non défini revient à l'IP du serveur NFS (ne fonctionne que lorsque `enable_nfs = true`) ; avec NFS également désactivé, le fallback n'est pas résolu et provoque une erreur de connexion au démarrage. |
| `memory_limit` | `2Gi` | Élevé | L'environnement d'exécution Node.js de Strapi et le panneau d'administration nécessitent une mémoire suffisante ; des valeurs inférieures à `512Mi` provoquent des arrêts OOM. |
| `min_instance_count` | `0` ou `1` | Moyen | `0` permet la mise à l'échelle à zéro ; la première requête après l'inactivité entraînera un démarrage à froid de 15 à 30 secondes. |
| `enable_iap` | activer pour l'administration | Moyen | Le panneau d'administration Strapi est autrement accessible publiquement. |
| `enable_cloud_armor` / `enable_cdn` | envisager pour la production | Moyen | Le CDN met en cache le contenu plus près des utilisateurs ; Cloud Armor fournit un WAF et une protection DDoS. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `secret_propagation_delay` | `30` | Faible | Un délai trop court peut entraîner des échecs de démarrage lors du premier déploiement si les secrets ne se sont pas encore propagés. |

---

Pour le comportement de base référencé tout au long — identité de service, mise
à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Strapi partagée avec la variante GKE est décrite
dans **[Strapi_Common](Strapi_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Strapi sur Cloud Run](../labs/Strapi_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Strapi sur GKE Autopilot](Strapi_GKE.md) — la même application sur Kubernetes, pour les cas où vous avez besoin de l'autre cible de déploiement.
- [Strapi Common — Configuration d'application partagée](Strapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
