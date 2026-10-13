---
title: "LimeSurvey sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LimeSurvey sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LimeSurvey_CloudRun.md @ e69407af sha256:a9c4ae52ec90 -->

# LimeSurvey sur Google Cloud Run {#limesurvey-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LimeSurvey_CloudRun.png" alt="LimeSurvey sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LimeSurvey est une plateforme de sondage et de questionnaire en ligne gratuite,
open source (GPL), écrite en PHP, prenant en charge un nombre illimité de
sondages, de branchements conditionnels, de quotas et de questionnaires
multilingues avec des résultats exportables. Ce module déploie LimeSurvey sur
**Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LimeSurvey et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, entrée et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
contrôles de service VPC, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## Ce que coûte LimeSurvey sur RAD, et comment cela se compare {#what-limesurvey-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de LimeSurvey sur RAD coûte environ 84 US$ par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 US$).** LimeSurvey lui-même est gratuit et open source (GPL), il s'agit donc du coût d'infrastructure de votre propre instance à réponses illimitées plutôt que d'une licence. Si vous n'en avez besoin qu'occasionnellement — une seule étude, une série de sondages saisonniers — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 84 US$ deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 US$ au prix de la recharge, 77 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque
application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **environ 84 US$** |

### Comment cela se compare {#how-it-compares}

- **Le propre projet de LimeSurvey vend LimeSurvey Cloud hébergé** sur [limesurvey.org/pricing](https://www.limesurvey.org/pricing) : Basic est à 66 £/mois (1 000 réponses/mois, 250 Mo, 1 administrateur) ; Expert est à 30 £/mois facturé annuellement (10 000 réponses/an, 1 Go, 3 administrateurs) ; Business est à 64 £/mois facturé annuellement (50 000 réponses/an, 3 Go, 5 à 10 administrateurs) ; Corporate est à prix personnalisé avec SSO/LDAP/SAML.
- **Expert, à environ 38 US$/mois, est moins cher que les 84 US$ de RAD** pour une utilisation légère et plafonnée. L'avantage de RAD augmente dès que vous avez besoin de plus de 10 000 réponses par an, de plus de trois administrateurs, ou que vous ne voulez aucun plafond de réponses/stockage — ce qu'aucun des plans hébergés en dessous de Corporate n'offre.
- Un VPS nu (Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go, environ 24 US$/mois) est moins cher que les deux en espèces, avec le compromis habituel de devoir gérer MySQL, les sauvegardes et les correctifs vous-même.
- Voir le [guide GKE](LimeSurvey_GKE.md) si vous préférez l'exécuter avec d'autres charges de travail Kubernetes.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LimeSurvey s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les
30 jours pour presque rien.** Cela convient bien mieux à LimeSurvey dont vous n'avez besoin
qu'occasionnellement — un projet de cours, une démo, une évaluation de courte durée — que de le
faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
  demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne
  détruit pas Cloud SQL, aucune VM ou le propre calcul de LimeSurvey un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et
  rattache son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Pour LimeSurvey
  derrière un petit Services_GCP et Project_GCP, c'est **une poignée de crédits
  (moins de 1 US$)** au total, contre les 80 crédits que coûte un
  redéploiement complet.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de LimeSurvey
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé LimeSurvey et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable
  dedans, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois que la fenêtre de 30 jours est passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  80 crédits (8,00 US$), car RAD
  recrée le projet et les services partagés avant LimeSurvey. La suppression permet d'économiser de l'argent
  seulement si LimeSurvey resterait inutilisé pendant environ trois jours
  ou plus, à la fois dans votre propre projet (environ 2,79 US$ par jour) et dans
  un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que LimeSurvey utilise.** La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de LimeSurvey alors que quelque chose d'autre partage le projet n'économise que la partie calcul de LimeSurvey.
- **Conservez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session LimeSurvey pour une classe. Chaque
  participant dispose de LimeSurvey dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie sa propre place. Tout est supprimé lorsque la
  session se termine, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute LimeSurvey pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de
  frais inattendus. À la fin de l'engagement, le partenaire transfère le projet,
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation quotidienne de 32 crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle. [Tarification LimeSurvey Cloud](https://www.limesurvey.org/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LimeSurvey s'exécute en tant que conteneur PHP/Apache sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 8080, 1 vCPU / 2 Gio par défaut ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixe et InnoDB est forcé |
| Persistance des fichiers | Cloud Filestore (NFS) | Persiste `/var/www/html/upload` après les redémarrages ; activé par défaut |
| Stockage d'objets | Cloud Storage | Un bucket `limesurvey-uploads` dédié provisionné automatiquement |
| Cache (facultatif) | Redis | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `ADMIN_PASSWORD` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire et InnoDB est forcé.** Le moteur est fixé par la couche
  d'application partagée (`database_type = MYSQL_8_0`). InnoDB est forcé car Cloud SQL
  désactive MyISAM — la valeur par défaut MyISAM de l'image échouerait autrement à la création de table au
  premier démarrage.
- **Le schéma est créé au premier démarrage du conteneur**, et non par un job de migration. Le
  job `db-init` ne provisionne qu'une base de données + un utilisateur vides ; l'installateur de la console LimeSurvey en amont construit ensuite le schéma lorsque l'application démarre. Prévoyez un temps de démarrage généreux lors du premier déploiement.
- **`ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret Manager. Le
  conteneur refuse de démarrer sans lui. Le premier super-administrateur est initialisé comme `admin` /
  `admin@techequity.cloud`.
- **Cloud SQL est accessible via TCP par défaut** (`enable_cloudsql_volume = false`) —
  LimeSurvey compose l'adresse IP privée de Cloud SQL via le réseau privé ; MySQL via
  TCP IP privée n'a pas besoin de SSL.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les actifs téléchargés survivent
  aux redémarrages du conteneur. Nécessite l'environnement d'exécution gen2 (par défaut).
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`) avec
  `max_instance_count = 1`. Les démarrages à froid ajoutent de la latence après l'inactivité ; définissez
  `min_instance_count = 1` pour maintenir le service toujours actif.
- **`PUBLIC_URL` est défini à partir de l'URL du service** au moment de la planification et corrigé à l'exécution
  par le point d'entrée du conteneur, de sorte que les liens de sondage et les actifs se résolvent sur l'hôte réel.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin que les répondants puissent
  accéder aux sondages publics. L'activation de l'IAP bloquera les répondants anonymes.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LimeSurvey {#a-cloud-run--the-limesurvey-service}

LimeSurvey s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

LimeSurvey stocke toutes les données d'application (sondages, questions, réponses, utilisateurs, paramètres globaux) dans une instance gérée de Cloud SQL pour MySQL 8.0. Par défaut, le service se connecte via **TCP IP privée** (`enable_cloudsql_volume = false`) ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de données et l'utilisateur de l'application ; le schéma est ensuite construit par l'installateur de LimeSurvey au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (NFS) {#c-cloud-filestore-nfs}

Activé par défaut, une instance Cloud Filestore (NFS) est montée dans le service afin que
le répertoire de téléchargement de LimeSurvey (`/var/www/html/upload` — images d'actifs, signatures,
codes-barres, fichiers de réponse téléchargés) persiste après les redémarrages et les révisions du conteneur.
Les montages NFS nécessitent l'environnement d'exécution gen2.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de découverte NFS partagé.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** dédié (`limesurvey-uploads`) est provisionné
automatiquement. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/       # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Redis (cache d'objets facultatif) {#e-redis-optional-object-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). C'est un cache d'objets facultatif et il n'est pas nécessaire au fonctionnement de LimeSurvey. Lorsque `redis_host` est laissé vide et que
`enable_nfs` est vrai, l'adresse IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Inspect env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager {#f-secret-manager}

Le mot de passe du super-administrateur LimeSurvey (`ADMIN_PASSWORD`) est généré
automatiquement et stocké dans Secret Manager, puis injecté en tant qu'environnement secret. Le
mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### G. Réseau et entrée {#g-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, permettant l'accès public nécessaire aux répondants anonymes. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LimeSurvey {#3-limesurvey-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte via le socket Cloud SQL (s'il est monté) ou le
  fallback TCP IP privée et crée de manière idempotente la base de données et l'utilisateur de l'application,
  accorde les privilèges et vérifie que l'utilisateur de l'application peut se connecter. Le job peut être réexécuté en toute sécurité.
- **Schéma créé au démarrage du conteneur.** Il n'y a pas de job de migration séparé. Une fois que
  `db-init` a provisionné une base de données vide, le point d'entrée `martialblog/limesurvey`
  en amont exécute l'installateur de la console LimeSurvey / `updatedb` au démarrage pour construire (ou
  mettre à niveau) le schéma. Si le conteneur signale un bon état mais que chaque page renvoie une erreur 500 avec
  "table settings_global not found", l'installateur a échoué silencieusement — presque toujours un
  problème de moteur de stockage (voir la note InnoDB ci-dessous) ou une base de données que l'installateur n'a pas pu
  atteindre.
- **InnoDB est forcé.** `DB_MYSQL_ENGINE = InnoDB` et `DBENGINE = InnoDB` sont définis
  car Cloud SQL désactive MyISAM. Ne les remplacez pas par MyISAM — la création de table échouera.
- **`ADMIN_PASSWORD` est requis.** Le conteneur se termine avec le code 1 sans lui. Il est
  auto-généré et stocké dans Secret Manager, et initialise le super-administrateur initial
  (`admin` / `admin@techequity.cloud`) au premier démarrage. Récupérez-le avant la première connexion :
  ```bash
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~admin-password' --format='value(name)' | head -1)" \
    --project "$PROJECT"
  ```
- **URL publique.** `PUBLIC_URL` est défini à partir de l'URL de service prédite au moment de la planification et
  corrigé à l'exécution à partir de `CLOUDRUN_SERVICE_URL`, de sorte que les liens de sondage et les actifs statiques
  se résolvent sur l'hôte Cloud Run réel. Confirmez l'URL déployée :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est TCP contre le port du conteneur ; la sonde de vivacité
  est `GET /` (LimeSurvey sert un 200 non authentifié à la page d'accueil racine).
  Prévoyez un temps de démarrage généreux pour l'installateur de la console.
- **Fichiers téléchargés.** Persistent sous `/var/www/html/upload` via le montage NFS. Sans
  NFS, les actifs téléchargés sont perdus lorsque l'instance est recyclée.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour LimeSurvey sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `limesurvey` | Nom de base du service, du dépôt de registre et des secrets. Ne pas modifier après le premier déploiement. |
| `display_name` | `LimeSurvey` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Correspond à la balise de base `martialblog/limesurvey` ; `latest` se résout en `6-apache` épinglé. Épinglez (par exemple `6-apache`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU minimum pour LimeSurvey + MySQL. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 512 Mio minimum, 2 Gio recommandé. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Gardez à 1 sauf si NFS partagé + gestion de session pour multi-instance est confirmé. |
| `container_port` | `8080` | LimeSurvey (Apache) écoute sur 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmentez pour les importations CSV volumineuses. |
| `enable_cloudsql_volume` | `false` | `false` utilise TCP IP privée vers MySQL ; définissez `true` pour le socket du proxy d'authentification. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` autorise les répondants anonymes. `internal` bloque le public. |
| `enable_iap` | `false` | Nécessite une connexion Google. **Bloque les répondants anonymes.** |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore et le monte pour persister `/var/www/html/upload`. Nécessite gen2. |
| `nfs_mount_path` | `/var/www/html/upload` | Chemin de montage du conteneur pour le volume NFS. |
| `create_cloud_storage` | `true` | Crée les buckets GCS déclarés. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé à MySQL 8.0. Les autres moteurs ne sont pas pris en charge. |
| `db_name` | `limesurvey` | Nom de la base de données (injecté comme `DB_NAME`). Immuable après le premier déploiement. |
| `db_user` | `limesurvey` | Utilisateur de la base de données de l'application (injecté comme `DB_USERNAME`). Mot de passe auto-généré dans Secret Manager. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Cache d'objets facultatif ; non requis. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un environnement d'exécution `gen1` avec des montages NFS/GCS, IAP sans identités autorisées, un `redis_port`/`backup_retention_days` hors de portée, un `database_type` qui ne correspond pas à une extension activée. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `DB_MYSQL_ENGINE` / `DBENGINE` (auto `InnoDB`) | Ne jamais définir sur MyISAM | Critique | Cloud SQL désactive MyISAM ; le `CREATE TABLE … ENGINE=MyISAM` de l'installateur échoue et chaque page renvoie une erreur 500 ("table settings_global not found"). |
| `database_type` | `MYSQL_8_0` | Critique | LimeSurvey nécessite MySQL ; le passage à Postgres/Aucun interrompt le démarrage. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de sondage. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer de Secret Manager | Critique | Le conteneur se termine avec le code 1 sans lui ; le modifier réinitialise le super-administrateur au prochain démarrage. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans URI de sauvegarde valide échoue au job d'importation. |
| `enable_nfs` | `true` | Élevé | Sans NFS, les actifs téléchargés sous `/var/www/html/upload` sont perdus lorsque l'instance est recyclée. |
| `max_instance_count` | `1` | Élevé | Plusieurs instances sans NFS partagé confirmé + gestion de session entraînent un état de téléchargement incohérent. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS/GCS nécessitent gen2 ; `gen1` échoue à la validation au moment de la planification. |
| `ingress_settings` | `all` | Élevé | `internal` empêche les répondants anonymes d'accéder aux sondages publics. |
| `enable_iap` | uniquement pour les sondages internes | Élevé | IAP nécessite une connexion Google pour chaque requête, bloquant les répondants anonymes. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio, risque d'OOM lors du rendu de grands sondages ou de l'importation CSV. |
| `enable_cloudsql_volume` | `false` (TCP) | Moyen | LimeSurvey/MySQL utilise TCP IP privée ; forcer le socket sans volume monté peut bloquer la connexion à la base de données. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après l'inactivité. |
| `application_version` | épingler (par exemple `6-apache`) | Moyen | `latest` se résout en `6-apache` épinglé ; une mise à jour majeure non épinglée peut nécessiter une mise à niveau du schéma. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à LimeSurvey
partagée avec la variante GKE est décrite dans
**[LimeSurvey_Common](LimeSurvey_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LimeSurvey sur Cloud Run](../labs/LimeSurvey_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [LimeSurvey sur GKE Autopilot](LimeSurvey_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [LimeSurvey Common — Configuration d'application partagée](LimeSurvey_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Flarum sur Google Cloud Run](Flarum_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md), [Rallly sur Google Cloud Run](Rallly_CloudRun.md) dans la solution **Communauté et Voix du client**.
