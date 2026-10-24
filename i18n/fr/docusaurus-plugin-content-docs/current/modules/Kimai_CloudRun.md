---
title: "Kimai sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Kimai sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kimai_CloudRun.md @ 1665a43e sha256:45d55fdb08bb -->

# Kimai sur Google Cloud Run {#kimai-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kimai_CloudRun.png" alt="Kimai sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kimai est une application de suivi du temps gratuite et open source (Symfony/PHP)
utilisée par les freelances et les agences pour le suivi des heures facturables,
les feuilles de temps et les rapports qui alimentent la facturation. Ce module
déploie Kimai sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud que Kimai utilise et sur la façon
de les explorer et de les exploiter à partir de la Google Cloud Console et de
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, entrée et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Kimai sur RAD, et comment cela se compare {#what-kimai-costs-on-rad-and-how-that-compares}

**Kimai sur le module Cloud Run de RAD coûte environ 70 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).** Kimai lui-même est gratuit et open source (AGPL), il s'agit donc du coût de l'infrastructure derrière votre propre instance, et non d'une licence. Si vous n'en avez besoin qu'occasionnellement — un seul engagement client, un contrat saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 70 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **70 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour**, soit environ 780 par mois (environ 78 $ US au prix de la recharge, 62 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque
application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 70 $ US** |

### Comment cela se compare {#how-it-compares}

- **Le propre projet de Kimai vend Kimai Cloud hébergé** sur [kimai.org/en/pricing](https://www.kimai.org/en/pricing) : le plan Standard est à 3,99 €/utilisateur/mois (2,99 € facturés annuellement) et le plan Professionnel (SSO, domaine personnalisé, sauvegardes quotidiennes) est à 4,99 €/utilisateur/mois (3,99 € annuellement). Pour une équipe de cinq personnes, cela représente environ 20 à 30 €/mois — moins cher en espèces que le chiffre de RAD ci-dessus, car le prix de Kimai Cloud évolue avec les utilisateurs plutôt que de supporter un coût fixe de base de données plus calcul.
- **Le coût de RAD n'augmente pas par utilisateur.** L'écart se réduit, puis s'inverse, à mesure qu'une équipe de freelance dépasse une dizaine ou une quinzaine de personnes, et que vous conservez votre propre instance Cloud SQL plutôt que l'équipe de Kimai ne détienne les données de feuille de temps.
- Un VPS nu (Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, environ 24 $ US/mois) est encore moins cher en espèces, avec le compromis habituel : vous gérez vous-même MySQL, les sauvegardes et les correctifs.
- Voir le [guide GKE](Kimai_GKE.md) pour un déploiement qui reste disponible pour une équipe plus grande.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Kimai s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option
qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et
restaurez-le dans les 30 jours pour presque rien.** Cela convient bien à Kimai
dont vous n'avez besoin qu'occasionnellement — un projet de cours, une démo, une
évaluation de courte durée — bien mieux que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la
  suppression d'un module, cela ne détruit pas Cloud SQL ou le calcul propre à Kimai un
  par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et
  rattache son compte de facturation, puis vous demande d'exécuter **Update** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Pour Kimai derrière un petit Services_GCP et Project_GCP, cela représente
  **une poignée de crédits (moins de 1 $ US)** au total, contre les 80 crédits que coûte un
  redéploiement complet.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous
  apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les
  30 jours — après cela, Google le supprime définitivement. La restauration est admise
  comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours
  dépasser le seuil du palier (100 crédits pour le palier sandbox, adapté à la plupart des
  études et des démonstrations). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  nocturnes de Kimai sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très
  probable qu'il disparaisse dès que vous supprimez le projet — même si le projet
  lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Kimai et que vous
  souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket
  extérieur au projet) avant de supprimer, comme pour le flux de travail de
  redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable,
  cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run s'adapte déjà à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  80 crédits (8,00 $ US), car RAD
  recrée le projet et les services partagés avant Kimai. La suppression permet d'économiser de l'argent
  seulement si Kimai resterait inutilisé pendant environ quatre jours
  ou plus, à la fois dans votre propre projet (environ 2,34 $ US par jour) et dans
  un projet géré par RAD (26 crédits par jour).
- **Supprimez tout ce que Kimai utilise.** La majeure partie du coût d'exécution est généralement la base de données. Elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de Kimai alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Kimai.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Kimai pour une classe. Chaque
  participant obtient Kimai dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie sa propre place. Tout est supprimé à la fin de la
  session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Kimai pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin de l'engagement, le partenaire transfère le projet,
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et l'estimation quotidienne de 26 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle. [Prix de Kimai Cloud](https://www.kimai.org/en/pricing). Les prix
changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Kimai s'exécute en tant que conteneur Symfony/PHP (l'image officielle `kimai/kimai2:apache`,
enveloppée dans un build personnalisé léger) sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Symfony/PHP, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — `Kimai_Common` fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage d'objets | Cloud Storage | Un bucket `storage`, monté GCS-FUSE à `/opt/kimai/var/data` pour les logos/modèles de facture téléchargés et les données de plugin |
| Secrets | Secret Manager | `APP_SECRET` (clé de signature Symfony) et `ADMINPASS` (mot de passe administrateur) générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par
  `Kimai_Common` ; la sélection de tout autre moteur interrompt le déploiement.
- **L'image wrapper personnalisée est requise, pas facultative.** `container_image_source
  = "custom"` construit une image légère `FROM kimai/kimai2` dont le point d'entrée compose
  la chaîne de connexion unique `DATABASE_URL` de Kimai au démarrage du conteneur à partir
  des valeurs secrètes injectées par la fondation — Cloud Run ne peut pas le faire au moment de la planification
  (voir §3).
- **`container_port = 8001`**, pas le port 80 — confirmé par des tests locaux `docker run`
  et un déploiement en direct. C'est le port d'écoute réel de la variante d'image `:apache`.
- **`enable_cloudsql_volume = false`.** Cloud Run se connecte à Cloud SQL via
  l'**IP privée directement (TCP)**, pas le socket Unix du proxy d'authentification. La variante GKE
  exécute plutôt un sidecar de proxy d'authentification.
- **Deux secrets Secret Manager, générés une seule fois.** `APP_SECRET` (clé de signature CSRF/session Symfony) et `ADMINPASS` (mot de passe initial du super-administrateur) —
  tous deux réinjectés depuis Secret Manager à chaque démarrage de conteneur, donc aucun
  volume persistant n'est nécessaire juste pour les maintenir stables.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent de la latence à la première requête
  après l'inactivité ; définissez `min_instance_count = 1` pour éviter cela.
- **`enable_nfs` par défaut `true` mais est fonctionnellement inutilisé.** Il monte
  Cloud Filestore NFS à `/var/lib/kimai`, mais le chemin de stockage persistant réel
  est le bucket `storage` monté GCS-FUSE à `/opt/kimai/var/data`.
  Rien n'écrit sur le montage NFS. Peut être désactivé en toute sécurité.
- **Pas de job de migration séparé.** `kimai:install` (création de schéma et
  migrations) s'exécute à chaque démarrage de conteneur, de manière idempotente, dans le cadre de la
  chaîne de point d'entrée du fournisseur — seul un job `db-init` est nécessaire pour
  créer la base de données et l'utilisateur au préalable.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Kimai {#a-cloud-run--the-kimai-service}

Kimai s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre
le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

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

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Kimai stocke toutes les données d'application (projets, activités, feuilles de temps, utilisateurs,
factures) dans une instance gérée de Cloud SQL pour MySQL 8.0. Le service se connecte
via l'**IP privée de l'instance via TCP** (pas le socket du proxy d'authentification —
`enable_cloudsql_volume` par défaut `false` pour ce module). Lors du premier déploiement, un
job `db-init` crée la base de données et l'utilisateur de l'application ; `kimai:install` crée
ensuite le schéma lors du premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Deux buckets GCS peuvent exister pour ce déploiement : un bucket `storage` provisionné
par `Kimai_Common` et monté GCS-FUSE à `/opt/kimai/var/data` (logos/modèles de facture
téléchargés, données de plugin), et un bucket **séparé**, générique au niveau de la fondation
(`storage_buckets`, par défaut un bucket nommé `data`) que Kimai ne lit ni
n'écrit à moins que vous ne le connectiez explicitement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`APP_SECRET` (clé de signature CSRF/session Symfony) et `ADMINPASS` (le mot de passe
initial du compte super-administrateur). Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kimai"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers
Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Kimai {#3-kimai-application-behaviour}

- **Une seule `DATABASE_URL` composée entièrement à l'exécution, non transmise via
  Terraform.** La couche Doctrine DBAL de Kimai lit une chaîne de connexion,
  `DATABASE_URL=mysql://user:pass@host:port/db?charset=utf8mb4&serverVersion=8.0`,
  pas des variables `DB_*` discrètes. Étant donné que le mot de passe de la base de données est un secret d'exécution
  inconnu au moment de la planification, et que Cloud Run n'interpole pas les références `$(VAR)`
  comme le fait Kubernetes, `Kimai_Common` construit une image wrapper personnalisée légère
  `FROM kimai/kimai2` dont le `entrypoint.sh` compose
  `DATABASE_URL` au démarrage du conteneur à partir des variables d'environnement
  `DB_USER`/`DB_NAME`/`DB_PASSWORD`/`DB_IP` injectées par la fondation — en encodant l'URL du
  mot de passe avec `php -r 'echo rawurlencode(...)'` (l'image n'a pas de
  `python3` ; c'est une image PHP) — avant de passer sans modification au
  propre `docker-php-entrypoint /entrypoint.sh` du fournisseur.
- **`DB_IP`, pas le standard `DB_HOST`.** Le wrapper lit l'hôte de
  `$DB_IP` (alias via `db_host_env_var_name = "DB_IP"`), qui se résout en
  l'IP privée brute de Cloud SQL sur Cloud Run — un hôte simple sans deux-points,
  sûr à placer directement dans une autorité d'URL `mysql://...`. Le standard
  `DB_HOST` peut plutôt être un chemin de répertoire de socket Unix Cloud SQL contenant
  des deux-points, ce qui briserait l'analyse d'URL s'il était utilisé de la même manière.
- **Vérifié localement avant même de toucher le cloud.** L'étape d'encodage d'URL du mot de passe et la vérification préalable d'attente de la base de données du fournisseur ont toutes deux été
  confirmées en construisant l'image wrapper et en l'exécutant localement contre un
  conteneur MySQL réel avec un mot de passe contenant des caractères spéciaux
  (`@:/?`), en détectant et en corrigeant les problèmes avant la première tentative de déploiement dans le cloud.
- **Comportement de la vérification de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /en/login` (la page de connexion de Kimai), qui renvoie `200` une fois que
  l'application est prête. `/` fonctionne également de manière générique (Kimai émet une redirection `302`
  depuis le chemin racine), mais `/en/login` est la cible précise et vérifiée
  effectivement configurée.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/en/login"   # expect 200
  ```
- **Le bootstrap administrateur s'exécute à chaque démarrage, de manière idempotente.** Le propre
  point d'entrée du fournisseur exécute `kimai:user:create admin "$ADMINMAIL" ROLE_SUPER_ADMIN
  "$ADMINPASS"` à chaque démarrage de conteneur lorsque `ADMINPASS` est défini — une
  opération nulle une fois le compte existant. **Le nom d'utilisateur est toujours `admin`**,
  codé en dur par l'image du fournisseur quelle que soit la valeur de `admin_email`.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Kimai sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kimai` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Kimai` | Nom lisible par l'homme affiché dans la Console. |
| `description` | `Kimai IT asset management on Cloud Run` | Texte générique restant dans la valeur par défaut livrée (hérité d'une source de clonage antérieure — Kimai est un suivi du temps, pas une gestion d'actifs) ; purement cosmétique, n'affecte pas le déploiement. |
| `application_version` | `latest` | Tag d'image pilotant le build `kimai/kimai2`. `"latest"` correspond au tag roulant `:apache` maintenu ; toute autre valeur correspond à `"<version>-apache"`. |
| `admin_email` | `admin@example.com` | E-mail du compte super-administrateur, injecté comme `ADMINMAIL`. Le nom d'utilisateur du compte est toujours `admin`, codé en dur par le point d'entrée du fournisseur. |
| `php_memory_limit` | `512M` | `memory_limit` PHP (le point d'entrée du fournisseur lit directement la variable d'environnement `memory_limit` en minuscules). |
| `enable_gcs_storage_volume` | `true` | Monte le bucket `storage` GCS-FUSE à `/opt/kimai/var/data`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper composant `DATABASE_URL` via Cloud Build — requis, non facultatif, pour ce module. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `8001` | La variante d'image `:apache` de Kimai écoute sur le port 8001, confirmé par des tests locaux et un déploiement en direct. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte directement via l'IP privée de Cloud SQL via TCP au lieu du socket Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre l'image en miroir dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas définir `DATABASE_URL` ici — il est composé à l'exécution par le point d'entrée du wrapper. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS
après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket GCS générique `data`. Non lu ou écrit par Kimai. |
| `enable_nfs` | `false` | **Fonctionnellement inutilisé** — monté à `/var/lib/kimai`, mais le véritable stockage persistant de Kimai est le bucket `storage` monté GCS-FUSE à `/opt/kimai/var/data`. Peut être désactivé en toute sécurité. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires (nécessite gen2), fusionnés avec le montage du bucket `storage`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Kimai_Common`. |
| `db_name` / `db_user` | `kimai` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `db_host_env_var_name` | `DB_IP` | Aliasse l'hôte de la base de données afin que la composition `DATABASE_URL` du wrapper lise un hôte simple, sans deux-points — le `DB_HOST` standard peut être un chemin de répertoire de socket sur Cloud Run, ce qui briserait l'analyse d'URL. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (les quatre) | **Inutilisé par Kimai** — le wrapper lit directement les `DB_USER`/`DB_NAME`/`DB_PASSWORD` standard et code en dur le port `3306`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` unique intégré. Il n'y a pas de job de migration séparé — `kimai:install` s'exécute à chaque démarrage de conteneur, de manière idempotente. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `GET /en/login`, 30s de délai, 20 tentatives | Généreux — couvre la vérification préalable d'attente de la base de données et `kimai:install` au premier démarrage. |
| `liveness_probe` | `GET /en/login`, 60s de délai, 3 tentatives | Page de connexion de Kimai, 200 une fois prête. |
| `uptime_check_config` | `{ enabled = false }` | Vérification de disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Kimai n'a pas d'intégration Redis intégrée utilisée par ce module — son backend de cache par défaut est le système de fichiers local. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Nom du job de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant qu'aucune ressource ne soit
> créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou
> de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_image_source` | `custom` | **Critique** | Le passage à `prebuilt` déploie l'image `kimai/kimai2` standard sans point d'entrée wrapper — `DATABASE_URL` n'est jamais composé, de sorte que l'application ne peut pas du tout atteindre MySQL (Kimai n'a pas d'autre moyen de recevoir une chaîne de connexion fonctionnelle sur Cloud Run). |
| `db_host_env_var_name` | `DB_IP` | Critique | Le wrapper compose `DATABASE_URL` à partir de cet alias spécifique. Le supprimer, ou le renommer de ce que `entrypoint.sh` attend, laisse le wrapper lire un hôte vide et l'application ne peut pas se connecter. |
| `container_port` | `8001` | Critique | La variante d'image `:apache` écoute sur le port 8001, pas le port 80 — pointer la plateforme vers le mauvais port rend le service inaccessible même si le conteneur est sain. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les feuilles de temps, projets et factures. |
| `APP_SECRET` (auto-généré) | Ne jamais modifier manuellement dans Secret Manager après le premier démarrage | Élevé | Kimai l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et les sessions actives. |
| Compte administrateur par défaut (nom d'utilisateur toujours `admin`, mot de passe dans le secret `ADMINPASS`) | Récupérez le mot de passe généré de Secret Manager et connectez-vous rapidement | Élevé | Contrairement à certaines applications de catalogue, le mot de passe administrateur ici est un secret réel, généré par déploiement — pas une valeur par défaut publique bien connue — mais il est toujours utile de confirmer qui a un accès en lecture au secret. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid à la première requête après l'inactivité. |
| `enable_nfs` | `false` sauf si nécessaire à d'autres fins | Faible / coût | Par défaut `true` et provisionne un partage Filestore que Kimai n'utilise jamais — un coût récurrent inutile ; la persistance réelle est le bucket `storage` monté GCS-FUSE. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le service est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Kimai
partagée avec la variante GKE est décrite dans
**[Kimai_Common](Kimai_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Kimai sur Cloud Run](../labs/Kimai_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Kimai sur GKE Autopilot](Kimai_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Kimai Common — Configuration d'application partagée](Kimai_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md), [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
