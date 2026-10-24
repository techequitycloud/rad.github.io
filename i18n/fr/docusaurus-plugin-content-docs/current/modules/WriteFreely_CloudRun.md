---
title: "WriteFreely sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de WriteFreely sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/WriteFreely_CloudRun.md @ 1665a43e sha256:6a5214215483 -->

# WriteFreely sur Google Cloud Run {#writefreely-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_CloudRun.png" alt="WriteFreely sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely est une plateforme de blog open source, minimaliste et fédérée, écrite en Go
— une alternative légère à Medium pour publier des écrits clairs et sans distraction.
Ce module déploie WriteFreely sur **Cloud Run v2** sur la base de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par WriteFreely et sur la manière de les explorer et de les
opérer depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte WriteFreely sur RAD, et comment cela se compare {#what-writefreely-costs-on-rad-and-how-that-compares}

**L'exécution de WriteFreely sur Cloud Run dans votre propre projet Google Cloud coûte environ 70,19 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 110 crédits facturé une fois au moment du déploiement. WriteFreely a besoin d'une base de données MySQL derrière lui, ce qui, avec le service Cloud Run, représente la majeure partie de ces 70,19 $. Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) et le coût d'exécution est mesuré toutes les heures en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](WriteFreely_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 70,19 $/mois, facturé par Google au prix catalogue | ~26 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **70,19 $** |

### Comment cela se compare {#how-it-compares}

- write.as, géré par la même équipe que WriteFreely, est la version hébergée officielle de ce logiciel : sa [page de tarification](https://write.as/pricing) (vérifiée le 8 octobre 2026) liste un niveau gratuit, Pro à 6 $/mois (annuel) ou 9 $/mois (mensuel) pour un maximum de trois blogs avec des thèmes personnalisés, et Team à 25 $/mois (annuel) ou 30 $/mois (mensuel) pour des publications partagées et collaboratives.
- Pro est moins cher que le coût d'exécution de 70,19 $/mois du projet propre de RAD car il s'agit d'un service multi-locataire partagé ; le module de RAD donne à WriteFreely son propre service Cloud Run dédié et sa base de données Cloud SQL, ce qui est important une fois que vous voulez un contrôle total des données, de la disponibilité et de l'identité de fédération plutôt qu'un hôte partagé.
- Une alternative VPS nu fonctionne également : un serveur Hetzner ou DigitalOcean 2 vCPU/4 Go à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 à environ 49 $/mois, est suffisant pour auto-héberger WriteFreely et MySQL ensemble — moins cher en espèces que RAD, sans les sauvegardes gérées, les correctifs ou la surveillance fournis par RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de
déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google affirme que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé WriteFreely et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener WriteFreely signifie redéployer
à partir de zéro. Cela coûte environ 113-116 crédits (les 110 crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si WriteFreely restait inutilisé assez longtemps pour compenser
le coût de redéploiement par rapport à son propre coût d'exécution — pour WriteFreely, cela représente environ 5 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données — elle ne s'arrête que si rien d'autre dans le projet ne l'utilise,
donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de labo, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application
dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur.
Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration. Prix des plans write.as depuis [write.as/pricing](https://write.as/pricing), vérifiés le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

WriteFreely s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le module corrige `MYSQL_8_0` ; accessible via **TCP IP privée** |
| Stockage d'objets | Cloud Storage | Un bucket de données `writefreely-uploads` dédié provisionné automatiquement |
| Secrets | Secret Manager | Trois secrets de clé AES-256 auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** `database_type = MYSQL_8_0` est défini par la couche
  d'application partagée. WriteFreely prend également en charge SQLite/PostgreSQL, mais ce
  module standardise sur Cloud SQL pour MySQL.
- **Cloud SQL est accessible via TCP IP privée, pas un socket.** Sur Cloud Run
  `enable_cloudsql_volume = false` — `DB_HOST` est l'IP privée de Cloud SQL et
  la configuration `go-sql-driver` de WriteFreely se connecte via TCP simple (Cloud SQL MySQL
  accepte le TCP IP privée non chiffré). Cela diffère de la variante GKE, qui utilise
  le sidecar Auth Proxy sur `127.0.0.1`.
- **Les trois clés AES-256 sont générées automatiquement** et stockées dans Secret Manager
  (`cookies-auth`, `cookies-enc`, `email-key`). Elles ne doivent **jamais** être renouvelées après
  le premier démarrage — les renouveler déconnecte tous les utilisateurs et rend les données de courrier électronique
  précédemment chiffrées indéchiffrables.
- **Une image personnalisée est construite, non tirée pré-construite.** `container_image_source = custom` :
  le wrapper de génération de configuration (rend `config.ini`, initialise les clés, exécute
  `writefreely db init`) est construit par Cloud Build et poussé vers Artifact Registry.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent quelques secondes à la première requête après
  l'inactivité ; définissez `min_instance_count = 1` pour maintenir le blog toujours chaud.
- **Aucun compte administrateur n'est créé automatiquement.** L'inscription est fermée
  (`open_registration = false`) ; créez le premier compte comme étape post-déploiement
  (voir §3).
- **WriteFreely est en Go — les paramètres Redis et PHP sont inertes.** Les variables `enable_redis` et
  `php_*` proviennent de l'échafaudage du module et ne sont pas consommées par WriteFreely.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service WriteFreely {#a-cloud-run--the-writefreely-service}

WriteFreely s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sécurisés.

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

WriteFreely stocke toutes les données d'application (blogs, articles, utilisateurs, sessions) dans une instance gérée
Cloud SQL pour MySQL 8.0. Sur Cloud Run, le service se connecte via **TCP IP privée**
(`enable_cloudsql_volume = false`) — aucune IP publique n'est exposée. Lors du premier déploiement, un
Job d'initialisation (`db-init`) crée la base de données et l'utilisateur de l'application ;
le point d'entrée du conteneur exécute ensuite `writefreely db init` pour construire les tables.

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

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié (`writefreely-uploads`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder l'accès. Des buckets supplémentaires
peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager —
les clés AES-256 que WriteFreely utilise pour signer les cookies de session (`cookies-auth`), chiffrer
les charges utiles des cookies (`cookies-enc`) et chiffrer les adresses e-mail stockées (`email-key`).
Elles sont injectées sous forme de `WF_KEY_COOKIES_AUTH`, `WF_KEY_COOKIES_ENC` et `WF_KEY_EMAIL`
et écrites dans le répertoire `keys/` du conteneur au démarrage. Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation, et
[WriteFreely_Common](WriteFreely_Common.md) pour savoir pourquoi ces clés doivent rester stables.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être superposé ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec une vérification de disponibilité et des politiques d'alerte facultatives. Le point d'entrée enregistre sa
progression (`WriteFreely: rendered config.ini …`, `… seeded stable encryption keys …`,
`… starting server …`), ce qui est utile pour diagnostiquer le premier démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application WriteFreely {#3-writefreely-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il crée la base de données et l'utilisateur de l'application, accorde `ALL
  PRIVILEGES` sur la base de données, vérifie que l'utilisateur de l'application peut se connecter et arrête le
  sidecar Cloud SQL Proxy. Le job est idempotent (`CREATE ... IF NOT EXISTS`,
  `max_retries = 3`) et peut être réexécuté en toute sécurité.
- **Schéma créé au démarrage.** Le point d'entrée du conteneur rend `config.ini` puis
  exécute `writefreely db init` à chaque démarrage pour créer les tables (tolérant si elles
  existent déjà), de sorte que le schéma est amorcé sans étape de migration distincte.
- **Les trois clés AES-256 sont immuables après le premier démarrage.** Elles sont générées une fois
  et écrites dans Secret Manager. La modification de l'une d'entre elles déconnecte tous les utilisateurs (les signatures de cookies
  ne sont plus valides) et rend les adresses e-mail précédemment chiffrées indéchiffrables. Ne les faites pivoter que
  pendant une fenêtre de maintenance planifiée, en sachant que toutes les sessions seront interrompues.
- **Créez le premier compte après le déploiement.** L'inscription est fermée par défaut
  (`open_registration = false`) et aucun administrateur n'est initialisé. Pour créer le premier compte,
  soit définissez temporairement `WF_OPEN_REGISTRATION = "true"` via `environment_variables`,
  inscrivez-vous via l'interface utilisateur, puis remettez-le à `"false"` ; soit exécutez
  `--create-admin` de WriteFreely sur le conteneur en cours d'exécution.
- **Correction de l'URL publique.** `WF_PUBLIC_URL` est défini sur l'URL de service prédite au
  moment de la planification et le point d'entrée revient à l'URL d'exécution `CLOUDRUN_SERVICE_URL`, de sorte que
  les liens générés utilisent le véritable hôte `run.app`. Vérifiez l'URL de la révision déployée :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est **TCP** (prête dès que le port 8080 est lié)
  et la sonde de vivacité est **HTTP `GET /`** — WriteFreely sert sa page d'accueil avec un
  `200` lorsqu'elle est saine ; il n'y a pas de point de terminaison `/health` dédié.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour WriteFreely sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `writefreely` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `WriteFreely` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag d'image `writeas/writefreely` ; `latest` résout l'image de base vers l'ARG de build `0.12.0` épinglé. Épinglez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure (secrets, stockage, IAM) sans le conteneur. |
| `container_image_source` | `custom` | Laissez comme `custom` — le wrapper de génération de configuration doit être construit. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU est suffisant pour un blog typique. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Instance unique par défaut. |
| `container_port` | `8080` | Le serveur web de WriteFreely se lie au port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `false` | **Désactivé** — Cloud Run atteint MySQL via TCP IP privée, pas un socket. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Autoriser le trafic internet public vers le blog. |
| `enable_iap` | `false` | Exiger la connexion Google devant WriteFreely. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires. Utilisez pour `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_OPEN_REGISTRATION`. Ne définissez pas `WF_KEY_*` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur MySQL fixe. |
| `db_name` | `writefreely` | Nom de la base de données → injecté comme `DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `writefreely` | Utilisateur de l'application → injecté comme `DB_USER`. Mot de passe auto-généré dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s | Prêt dès que le port 8080 est lié. |
| `liveness_probe` | HTTP `/`, délai de 30s | Redémarre le conteneur si la page d'accueil ne répond plus. La sonde de démarrage TCP couvre déjà les démarrages lents. |

### Groupe 21 — Redis (inerte pour WriteFreely) {#group-21--redis-inert-for-writefreely}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Non consommé** — WriteFreely stocke tout l'état dans MySQL. Reste de l'échafaudage. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

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
| `database_host` / `database_port` | Point de terminaison (IP privée) / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et
> les combinaisons* au moment de la planification — IAP sans identités autorisées, un runtime `gen1`
> avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un
> `backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Clés AES-256 (`WF_KEY_*`, auto-générées) | Ne jamais faire pivoter après le premier démarrage | Critique | La rotation déconnecte tous les utilisateurs et rend les données de courrier électronique chiffrées indéchiffrables. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `MYSQL_8_0` | Critique | Changer le moteur après le premier déploiement orphelinise les données existantes. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `container_image_source` | `custom` | Élevé | Définir `prebuilt` sans une image qui intègre le point d'entrée de génération de configuration donne un conteneur qui ne peut pas rendre `config.ini` et ne démarre pas. |
| `enable_cloudsql_volume` | `false` | Élevé | Sur Cloud Run, forcer le socket sans logique de point d'entrée correspondante interrompt la connectivité MySQL ; l'IP privée TCP est le chemin testé. |
| `application_version` | Épingler une version | Moyen | `latest` peut déplacer l'image de base lors des redéploiements ; l'épinglage maintient les builds reproductibles. |
| `ingress_settings` | `all` | Moyen | `internal` rend le blog inaccessible depuis l'internet public. |
| `enable_iap` | Désactivé pour un blog public | Moyen | IAP bloque tous les lecteurs non authentifiés. |
| `min_instance_count` | `1` pour toujours chaud | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| `WF_OPEN_REGISTRATION` | `false` après le premier administrateur | Moyen | Laisser l'inscription ouverte permet à toute personne ayant l'URL de créer un compte. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à WriteFreely
partagée avec la variante GKE est décrite dans
**[WriteFreely_Common](WriteFreely_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : WriteFreely sur Cloud Run](../labs/WriteFreely_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WriteFreely sur GKE Autopilot](WriteFreely_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [WriteFreely Common — Configuration d'application partagée](WriteFreely_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Créateur et publication de médias**.
