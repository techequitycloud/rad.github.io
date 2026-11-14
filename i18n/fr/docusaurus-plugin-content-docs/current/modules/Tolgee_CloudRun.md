---
title: "Tolgee sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Tolgee sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Tolgee_CloudRun.md @ 40c83c3f sha256:29da490e9ce4 -->

# Tolgee sur Google Cloud Run {#tolgee-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tolgee_CloudRun.png" alt="Tolgee sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tolgee est une plateforme open source de **localisation (i18n) et de gestion de la
traduction** conviviale pour les développeurs, basée sur Spring Boot. Ce module déploie
Tolgee sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Tolgee et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## Ce que coûte Tolgee sur RAD, et comment cela se compare {#what-tolgee-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Tolgee sur RAD coûte environ 180,87 $ US par mois dans un projet Google Cloud que vous possédez, avec des frais de module uniques de 175 crédits (17,50 $ US, ou 157,5 crédits dans un projet géré par RAD, soit 10 % de moins).** Cette configuration maintient le service en fonctionnement continu plutôt que de le mettre à l'échelle à zéro. GKE Autopilot est l'option la moins chère ; voir le [guide GKE](Tolgee_GKE.md), à environ 149,81 $ US par mois pour les mêmes frais de module. Si vous n'avez besoin de Tolgee qu'occasionnellement — une poussée de traduction avant une version, une évaluation avant de l'adopter — un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **180,87 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **113 crédits par jour**, soit environ 3 390 par mois (environ 339 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum de crédits achetés est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (toujours actif) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **180,87 $ US** |

### Comment cela se compare {#how-it-compares}

- Le plan hébergé de Tolgee, **Tolgee Cloud**, commence par un niveau gratuit (30 000 mots, 3 sièges), puis **Translate** à **58 €/mois** (environ 63 $ US), **Optimise** à **133 €/mois** (environ 144 $ US), et **Manage** à **373 €/mois** (environ 403 $ US), tous facturés annuellement (source : [tolgee.io/pricing](https://tolgee.io/pricing)). Le chiffre de RAD pour un projet propre se situe entre les niveaux Translate et Optimise de Tolgee Cloud, mais il achète une instance dédiée avec sa propre base de données et son propre serveur de fichiers plutôt qu'une instance partagée et limitée en sièges.
- Une comparaison autogérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go est au même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est d'environ 49 $/mois — tous moins chers en termes d'argent, mais l'exécution d'une plateforme i18n toujours active avec sa propre base de données et son propre serveur de fichiers signifie des correctifs, des sauvegardes et du TLS à la main.
- La disponibilité continue par défaut de Tolgee est ce qui rend le coût d'exécution de ce guide plus élevé que de nombreux autres modules sur RAD — les flux de travail de traduction sont généralement vérifiés tout au long de la journée de travail plutôt que d'être ouverts occasionnellement, il est donc configuré pour ne pas se mettre à l'échelle à zéro.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Tolgee s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, la VM NFS ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement opérationnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez des clés de traduction et un historique que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer Tolgee purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) — 175 crédits (17,50 $ US) dans votre propre projet, ou 157,5 crédits dans un projet géré par RAD.

La suppression permet d'économiser de l'argent seulement si Tolgee resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 6,03 $ US par jour), cela représente environ 3 jours ou plus, ou environ 2 jours ou plus dans un projet géré par RAD (113 crédits par jour). La majeure partie du coût d'exécution ici est l'instance Cloud Run toujours active plus la base de données et le serveur de fichiers NFS ; ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Tolgee pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tolgee.io/pricing](https://tolgee.io/pricing) pour les plans hébergés de Tolgee Cloud.

## 1. Vue d'ensemble {#1-overview}

Tolgee s'exécute comme un conteneur Java / Spring Boot sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Spring Boot, 2 vCPU / 4 GiB par défaut, autoscaling sans serveur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Tolgee ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket pour le stockage de fichiers optionnel (captures d'écran/importations) |
| Secrets | Secret Manager | Mot de passe administrateur initial et secret de signature JWT générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée ; la sélection de tout autre moteur interrompt le démarrage.
- **Tolgee se connecte à Cloud SQL via TCP, pas un socket Unix.** Son pilote JDBC
  PostgreSQL intégré ne peut pas utiliser un socket, donc sur Cloud Run, le point
  d'entrée se connecte via l'**IP privée** de Cloud SQL avec `sslmode=require`. C'est pourquoi
  `enable_cloudsql_volume` est par défaut **`false`** ici (pas de sidecar de socket Auth Proxy).
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager. Il ne doit
  jamais être renouvelé après le premier démarrage sans fenêtre de maintenance — le
  renouvellement invalide immédiatement toutes les sessions utilisateur actives.
- **`SERVER_PORT`, pas `PORT`.** Tolgee lit `SERVER_PORT = 8080` ; Cloud Run réserve
  `PORT`, donc le module définit `SERVER_PORT` explicitement.
- **`min_instance_count` est par défaut `1` et `cpu_always_allocated` à `true`.** Tolgee
  exécute des opérations par lots asynchrones (traduction automatique en masse,
  importations, suppressions) dans des threads d'arrière-plan internes après le retour de
  la requête ; la facturation basée sur les requêtes les limiterait à ~0 CPU. Activez les
  deux (`false` + `min = 0`) uniquement pour un déploiement purement interactif,
  privilégiant le coût, qui n'exécute pas de gros jobs par lots.
- **Pas de Redis.** Tolgee stocke tout l'état de traduction dans PostgreSQL ; `enable_redis`
  est par défaut `false`.
- **Le schéma est créé par Liquibase au premier démarrage.** Il n'y a pas de job de
  migration séparé — le socle crée le rôle/la base de données et Tolgee migre
  automatiquement au démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Tolgee {#a-cloud-run--the-tolgee-service}

Tolgee s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge
des requêtes entre les nombres minimum et maximum d'instances. Chaque déploiement crée
une révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Tolgee stocke toutes les données d'application (projets, langues, clés, traductions,
utilisateurs) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se
connecte via l'**IP privée** de Cloud SQL (TCP, `sslmode=require`) plutôt qu'un socket Unix,
car le pilote JDBC de Tolgee ne peut pas utiliser un socket. Lors du premier déploiement,
l'étape `create-db-and-user.sh` du socle crée la base de données et le rôle ; Tolgee exécute
ensuite ses propres migrations Liquibase au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** (`name_suffix = "storage"`) est provisionné pour le stockage de fichiers
optionnel — Tolgee conserve les traductions dans PostgreSQL, donc ce bucket ne contient
que les captures d'écran téléchargées ou les artefacts d'importation si vous le montez
via `gcs_volumes` ou configurez le stockage de fichiers compatible S3 de Tolgee.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/            # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : le
**mot de passe administrateur initial** (`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`) utilisé pour se connecter pour
la première fois, et le **secret de signature JWT** (`TOLGEE_AUTHENTICATION_JWT_SECRET`) utilisé pour signer
tous les jetons de session utilisateur. Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`). Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud
Armor peut être superposé ; les paramètres d'entrée et de sortie VPC contrôlent la
connectivité. Comme Tolgee se connecte à Cloud SQL via l'IP privée, le service nécessite
une sortie VPC (fournie par le socle).

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des
stratégies d'alerte optionnels. Le point de terminaison `/actuator/health` est utilisé pour
le test de disponibilité provisionné lorsque le service est publiquement accessible.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Tolgee {#3-tolgee-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Aucun job d'initialisation
  dédié n'est exécuté — l'étape `create-db-and-user.sh` du socle App_CloudRun crée le rôle et la
  base de données PostgreSQL et accorde la propriété du schéma. Tolgee crée et migre
  ensuite l'intégralité de son schéma avec **Liquibase** automatiquement au premier
  démarrage.
- **Migrations au démarrage.** Tolgee applique ses changements Liquibase à chaque
  démarrage, de sorte que la mise à niveau de `application_version` applique les changements de
  schéma sans étape séparée.
- **Le secret JWT est immuable après le premier démarrage.** Il est généré une fois et
  écrit dans Secret Manager et reste stable entre les redémarrages et les instances. Le
  renouvellement de `TOLGEE_AUTHENTICATION_JWT_SECRET` invalide immédiatement toutes les sessions utilisateur
  actives — ne le renouvelez que pendant une fenêtre de maintenance planifiée.
- **Connexion à la première exécution.** Après le déploiement, connectez-vous en tant que
  propriétaire initial : `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (par défaut `admin@techequity.cloud`) avec le mot de passe
  généré par Secret Manager. Changez le mot de passe et configurez des fournisseurs
  d'authentification supplémentaires (Google/OAuth2/SSO) depuis l'interface utilisateur
  de Tolgee avant de passer en production.
- **Chemin de santé.** Les sondes de vivacité/démarrage/disponibilité ciblent
  **`/actuator/health`**, qui renvoie un `200` non authentifié uniquement après la
  fin des migrations Liquibase. Prévoyez plusieurs minutes au premier démarrage (délai
  initial de 60 secondes plus une large fenêtre d'échec) — Spring Boot + les migrations
  de première exécution démarrent plus lentement qu'une application Node typique.
- **Les opérations par lots s'exécutent en arrière-plan.** La traduction automatique en
  masse, les importations et les suppressions s'exécutent de manière asynchrone dans des
  threads internes après le retour de la requête, c'est pourquoi `cpu_always_allocated = true` et
  `min_instance_count = 1` sont les valeurs par défaut.
- **Inspectez le câblage de la base de données de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Tolgee sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tolgee` | Nom de base du service Cloud Run et des secrets. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image Tolgee utilisé comme `FROM tolgee/tolgee:<tag>` pour le build de wrapper personnalisé léger. Épinglez à une version (par exemple `v3.130.4`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. Tolgee nécessite **au moins 2 GiB** pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Maintient le traitement des opérations par lots asynchrones entre les requêtes. `0` (mise à l'échelle à zéro) est sûr pour une utilisation purement interactive. |
| `max_instance_count` | `5` | Plafond de coût. Doit être ≥ `min_instance_count`. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué afin que les jobs par lots internes se terminent. Passez à `false` (+ `min = 0`) pour les déploiements purement interactifs et axés sur les coûts. |
| `container_port` | `8080` | `SERVER_PORT` de Spring Boot de Tolgee. |
| `container_image_source` | `custom` | Construit le wrapper léger via Cloud Build. |
| `enable_cloudsql_volume` | `false` | **Par défaut faux** — le pilote JDBC de Tolgee ne peut pas utiliser un socket Cloud SQL, il se connecte donc via l'IP privée (TCP, `sslmode=require`). |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Permet l'accès public à l'interface utilisateur/API de Tolgee. Restreindre ou utiliser IAP pour les déploiements privés. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Cloud Filestore NFS pour le stockage optionnel des pièces jointes de Tolgee. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse pour le bucket de stockage de fichiers optionnel. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `tolgee` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `tolgee` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Laissez désactivé — Tolgee stocke tout l'état dans PostgreSQL et ne nécessite pas Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

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
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur
> de socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les
> combinaisons* au moment du plan — un `redis_port`/`backup_retention_days` hors de portée, IAP
> sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un
> `database_type` qui ne correspond pas à une extension activée. Une configuration
> invalide échoue le **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont
> plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `TOLGEE_AUTHENTICATION_JWT_SECRET` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Critique | Le renouvellement invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate pour tout le monde. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `false` | Critique | Le pilote JDBC de Tolgee ne peut pas utiliser un socket Cloud SQL ; l'activation pointe `DB_HOST` vers un répertoire de socket et interrompt la connexion à la base de données. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous de ~2 GiB, la JVM Spring Boot OOM lors des migrations Liquibase au premier démarrage. |
| `application_version` | Épingler en production | Élevé | `latest` peut tirer une nouvelle version majeure avec des migrations incompatibles lors du redéploiement. |
| `enable_redis` | `false` | Moyen | Redis est inutilisé ; l'activer ajoute des coûts sans avantage. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` | Moyen | Passer à la demande + mise à l'échelle à zéro limite les jobs par lots asynchrones (MT/importations en masse) à ~0 CPU et les bloque. |
| `startup_probe` (`/actuator/health`) | Garder la large fenêtre de premier démarrage | Moyen | Une fenêtre trop étroite fait échouer la révision pendant que les migrations Liquibase sont toujours en cours sur une nouvelle base de données. |
| `ingress_settings` | `all` (ou IAP) | Moyen | Laisser public sans authentification expose l'interface utilisateur/API de Tolgee ; le mot de passe administrateur initial doit être modifié immédiatement. |

---

Pour le comportement du socle référencé tout au long — identité de service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Tolgee
partagée avec la variante GKE est décrite dans **[Tolgee_Common](Tolgee_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Tolgee sur Cloud Run](../labs/Tolgee_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Tolgee sur GKE Autopilot](Tolgee_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Tolgee Common — Configuration d'application partagée](Tolgee_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Unleash sur Google Cloud Run](Unleash_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md) dans la solution **Gestion des versions et qualité**.
