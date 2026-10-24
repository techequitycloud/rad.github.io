---
title: "Roundcube sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Roundcube sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Roundcube_CloudRun.md @ 1665a43e sha256:79a58d868f04 -->

# Roundcube sur Google Cloud Run {#roundcube-on-google-cloud-run}

Roundcube est un client webmail IMAP gratuit, open source et basé sur un
navigateur. Il offre aux utilisateurs une expérience de messagerie de type
ordinateur de bureau — dossiers, carnet d'adresses, recherche et composition de
messages — avec un serveur de messagerie IMAP et SMTP déjà existant. Roundcube
est un **client** de messagerie : ce module ne déploie aucun serveur de
messagerie. Il déploie Roundcube sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Roundcube et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Roundcube sur RAD, et comment cela se compare {#what-roundcube-costs-on-rad-and-how-that-compares}

**L'exécution de Roundcube dans votre propre projet GCP coûte environ 70,19 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~70,19 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~26 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **70,19 $** |

### Comment cela se compare {#how-it-compares}

- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Roundcube est un client webmail léger, pas un serveur de messagerie — il est interrogé chaque fois que quelqu'un consulte son courrier, de sorte que son propre coût de calcul est modeste et que la base de données derrière lui est le principal coût permanent.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la
suppression d'un module, cela ne supprime pas Cloud SQL, une VM ou la ressource de calcul
une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il
attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu.
Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources
déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la création
d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations
d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à
nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez
une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de la
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Roundcube purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de temps de build.

La suppression permet d'économiser de l'argent seulement si Roundcube resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie de calcul propre à cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Roundcube s'exécute en tant que conteneur PHP (l'image officielle `roundcube/roundcubemail`
`-apache`, enveloppée par un point d'entrée personnalisé léger) sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Données propres à Roundcube — préférences, contacts, données de session. Le courrier lui-même reste sur le serveur IMAP |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` est provisionné, mais Roundcube ne le lit ni ne l'écrit |
| Secrets | Secret Manager | `des_key` auto-généré (`ROUNDCUBEMAIL_DES_KEY`) ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Courrier | _(aucun — externe)_ | Vous fournissez les serveurs IMAP et SMTP |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Aucun serveur IMAP ou SMTP n'est configuré.** Le module définit
  `ROUNDCUBEMAIL_DEFAULT_HOST` et `ROUNDCUBEMAIL_SMTP_SERVER` à des valeurs vides,
  et ce wrapper n'expose aucune entrée pour eux. Définissez-les dans
  `environment_variables` (Groupe 6) avant que quiconque ne puisse se connecter — voir
  [§3](#3-roundcube-application-behaviour).
- **Pas de comptes locaux.** Les utilisateurs se connectent avec leur nom d'utilisateur et leur mot de passe IMAP.
  Il n'y a pas de compte administrateur ni de secret de mot de passe administrateur.
- **MySQL 8.0 uniquement.** Le point d'entrée du wrapper compose toujours un DSN `mysql://`.
- **`enable_cloudsql_volume = false`.** Le DSN utilise `DB_IP`, l'IP privée de Cloud SQL,
  donc Cloud Run se connecte via **TCP IP privée**, et non le socket Unix du proxy d'authentification.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent de la latence à la première requête après
  l'inactivité ; définissez `min_instance_count = 1` pour éviter cela.
- **Pas de job de schéma séparé.** L'image exécute `bin/installto.sh -y` à chaque
  démarrage, ce qui crée et met à jour le schéma de manière idempotente. Seul `db-init`
  s'exécute en tant que job Cloud Run.
- **Tag d'image épinglé.** `application_version = "1.6.19-apache"`. Gardez un tag exact — un
  tag glissant se reconstruit sans produire une nouvelle révision.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Roundcube {#a-cloud-run--the-roundcube-service}

Roundcube s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre
le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Roundcube stocke ses propres données — préférences utilisateur, contacts du carnet d'adresses et
données de session — dans une instance Cloud SQL gérée pour MySQL 8.0. Le courrier n'est jamais
stocké ici ; il reste sur le serveur IMAP. Le service se connecte via l'**IP privée de l'instance via TCP**. Lors du premier déploiement, le job `db-init` crée la
base de données et l'utilisateur de l'application ; le schéma est ensuite créé par Roundcube lui-même
(`bin/installto.sh -y`) au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket générique `data` est provisionné par défaut (via l'entrée
`storage_buckets` de la Fondation), mais Roundcube ne le lit ni ne l'écrit jamais :
`gcs_volumes` est vide, donc aucun bucket n'est monté dans le conteneur. Les
pièces jointes en transit sont écrites dans un espace de travail local au conteneur
(`ROUNDCUBEMAIL_TEMP_DIR = /tmp/roundcube-temp`), qu'il est sûr de perdre lors d'un démarrage à froid.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret d'application est généré automatiquement : la clé `des_key` de 24 caractères,
stockée sous le nom `secret-<prefix>-roundcube-des-key` et injectée sous le nom
`ROUNDCUBEMAIL_DES_KEY`. Roundcube l'utilise pour chiffrer les données de session et le mot de passe IMAP
qu'il détient au nom de chaque utilisateur connecté. Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~des-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.
Roundcube établit également des connexions **sortantes** vers vos serveurs IMAP et SMTP ; avec le `vpc_egress_setting = PRIVATE_RANGES_ONLY` par défaut, le trafic vers un serveur de messagerie public part directement plutôt que via le VPC.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers
Cloud Monitoring. Le test de disponibilité est **désactivé** par défaut
(`uptime_check_config.enabled = false`) ; les stratégies d'alerte sont facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Roundcube {#3-roundcube-application-behaviour}

- **Pointer Roundcube vers un serveur de messagerie.** `Roundcube_Common` définit ces
  variables d'environnement, et `environment_variables` (Groupe 6) est fusionné par-dessus
  elles, c'est donc là que vous configurez le serveur de messagerie :

  | Variable | Valeur par défaut | Signification |
  |---|---|---|
  | `ROUNDCUBEMAIL_DEFAULT_HOST` | `""` | Serveur IMAP sur lequel les utilisateurs se connectent. `ssl://host` pour TLS implicite, `tls://host` pour STARTTLS ; un nom d'hôte nu est en clair. |
  | `ROUNDCUBEMAIL_DEFAULT_PORT` | `993` | Port IMAP — 993 pour TLS implicite, 143 pour STARTTLS. |
  | `ROUNDCUBEMAIL_SMTP_SERVER` | `""` | Serveur SMTP utilisé pour l'envoi. |
  | `ROUNDCUBEMAIL_SMTP_PORT` | `587` | Port de soumission — 587 ou 465. **Jamais 25** : Google Cloud bloque le port 25 sortant. |
  | `ROUNDCUBEMAIL_SKIN` | `elastic` | Thème Roundcube. |

  `Roundcube_Common` a des entrées `imap_host`/`imap_port`/`smtp_host`/`smtp_port`/`skin`
  qui alimentent ces valeurs, mais `Roundcube_CloudRun` ne les déclare ni ne les
  transmet, donc sur ce wrapper `environment_variables` est la seule voie d'accès.
- **Connexion.** Ouvrez l'URL du service et connectez-vous avec un compte sur le serveur IMAP.
  Roundcube n'a pas de comptes locaux ou d'administrateur.
- **DSN de la base de données.** Le point d'entrée du wrapper compose
  `ROUNDCUBEMAIL_DSNW=mysql://DB_USER:<password>@DB_IP:DB_PORT/DB_NAME` avec le
  mot de passe encodé en URL par `rawurlencode` de PHP, définit `ROUNDCUBEMAIL_DSNR` à la
  même valeur, et transmet le contrôle à `/docker-entrypoint.sh` de l'image. Le
  point d'entrée du fournisseur interpolerait autrement le mot de passe brut, ce qui échoue sur
  les caractères `@ : / ? # % & +` que contiennent les mots de passe Cloud SQL.
- **Schéma.** Il n'y a pas de job de schéma : l'image exécute `bin/installto.sh -y` à
  chaque démarrage, créant le schéma au premier démarrage et le mettant à jour après un
  changement de version.
- **Limite de mémoire PHP.** `php_memory_limit` atteint le conteneur en tant que
  `PHP_MEMORY_LIMIT` ; le point d'entrée l'écrit dans
  `/usr/local/etc/php/conf.d/zz-rad-overrides.ini`, annulant le propre
  `memory_limit=64M` de l'image. Le journal du conteneur le confirme au démarrage :
  `[startup] PHP memory_limit set to 512M via ...`.
- **Comportement de la vérification de l'état de santé.** Les deux sondes sont **HTTP `GET /`**, où Roundcube
  sert son formulaire de connexion. La sonde de démarrage autorise un délai de 30 s plus 20 × 15 s
  tentatives, car l'image exécute `installto.sh` et attend la base de données
  avant le démarrage d'Apache.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
  ```
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Roundcube sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court (1 à 7 caractères alphanumériques minuscules) qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `roundcube` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Roundcube` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `1.6.19-apache` | Tag `roundcube/roundcubemail`, passé comme ARG de build `ROUNDCUBE_VERSION`. La valeur de ce wrapper est celle qui l'emporte. Épinglez un tag `-apache` exact. |
| `php_memory_limit` | `512M` | `memory_limit` PHP, appliqué via `conf.d/zz-rad-overrides.ini`. |
| `admin_email` | `admin@example.com` | **Aucun effet** — Roundcube ne crée pas de comptes. |
| `enable_gcs_storage_volume` | `true` | **Aucun effet** — `Roundcube_Common` le déclare mais ne l'utilise jamais ; rien n'est monté. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `"prebuilt"` ignore le point d'entrée du wrapper, de sorte que le DSN n'est plus encodé en URL et `php_memory_limit` cesse de fonctionner. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `false` | Le DSN utilise `DB_IP` sur TCP ; le socket n'est pas utilisé. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. Utilisez `ALL_TRAFFIC` uniquement si les serveurs IMAP/SMTP doivent être atteints via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant la connexion Roundcube. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés avec les valeurs par défaut du module. Définissez `ROUNDCUBEMAIL_DEFAULT_HOST`, `ROUNDCUBEMAIL_DEFAULT_PORT`, `ROUNDCUBEMAIL_SMTP_SERVER`, `ROUNDCUBEMAIL_SMTP_PORT` et, éventuellement, `ROUNDCUBEMAIL_SKIN` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `protect_sensitive_environment_variables` | `true` | Les clés nommées par les identifiants saisies dans `environment_variables` sont automatiquement déplacées vers Secret Manager. |
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

### Groupe 9 — Scripts SQL personnalisés et serveur NFS {#group-9--custom-sql-scripts--nfs-server}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement.
`nfs_instance_name` / `nfs_instance_base_name` sélectionnent ou nomment une VM NFS, et ne
sont importants que si `enable_nfs` est activé. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Liste blanche CIDR pour l'accès privilégié. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket GCS générique `data`. Non lu ni écrit par Roundcube. |
| `enable_nfs` | `false` | Non nécessaire — l'image ne déclare aucun volume et ne conserve aucun état sur le disque qui doit survivre à un redémarrage. |
| `nfs_mount_path` | `/var/lib/roundcube` | Chemin de montage, utilisé uniquement lorsque `enable_nfs = true`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). Vide — rien n'est monté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Doit rester MySQL — le point d'entrée compose un DSN `mysql://`. Le sélecteur propose également `POSTGRES` et `NONE` ; aucun ne fonctionne. |
| `db_name` / `db_user` | `roundcube` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). Définir une fois — le modifier sur un déploiement en cours rompt l'authentification de la base de données. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base de données. |
| `rotation_propagation_delay_sec` | `90` | Attendre après la rotation avant de redémarrer le service. |
| `db_host_env_var_name` | `DB_IP` | Nom supplémentaire pour l'IP de l'hôte de la base de données. La Fondation injecte déjà `DB_IP`, ce que le point d'entrée lit, donc la valeur par défaut ne fait que le dupliquer. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Fournir une liste le remplace. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, délai de 30s, timeout de 10s, période de 15s, 20 tentatives | Attend `installto.sh` et la base de données avant le démarrage d'Apache. |
| `liveness_probe` | HTTP `GET /`, délai de 60s, timeout de 10s, période de 30s, 3 tentatives | Le formulaire de connexion à la racine du document. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring — désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Ce module ne connecte aucune intégration Redis à Roundcube. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Services de la phase Cloud Deploy (lorsqu'activés). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Une configuration invalide fait échouer la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ROUNDCUBEMAIL_DEFAULT_HOST` / `ROUNDCUBEMAIL_SMTP_SERVER` (via `environment_variables`) | Vos serveurs IMAP et SMTP | **Élevé** | Laissé vide par défaut. Le service est sain et affiche son formulaire de connexion, mais aucun utilisateur ne peut se connecter ou envoyer de courrier. Un contrôle de santé vert ne prouve pas que le courrier fonctionne. |
| `ROUNDCUBEMAIL_SMTP_PORT` | `587` ou `465` | **Élevé** | Google Cloud bloque le port 25 sortant pour toutes les sorties ; l'envoi via le port 25 ne réussit jamais. |
| Schéma `ROUNDCUBEMAIL_DEFAULT_HOST` | `ssl://host` ou `tls://host` | **Élevé** | Un nom d'hôte nu se connecte en clair, envoyant les mots de passe IMAP des utilisateurs non chiffrés. N'utilisez un hôte nu que pour un serveur à l'intérieur du VPC. |
| `ROUNDCUBEMAIL_DES_KEY` (auto-généré) | Ne jamais modifier manuellement dans Secret Manager | Élevé | Il chiffre les données de session et les mots de passe IMAP stockés. Le modifier déconnecte tous les utilisateurs ; le supprimer fait que l'image du fournisseur crée une clé différente par conteneur, déconnectant les utilisateurs au hasard entre les instances et les démarrages à froid sans rien dans les journaux. |
| `container_image_source` | `custom` | **Critique** | `prebuilt` déploie une image sans le point d'entrée du wrapper — le mot de passe de la base de données n'est plus encodé en URL dans le DSN, de sorte que la connexion échoue sur la ponctuation que contiennent les mots de passe Cloud SQL. |
| `database_type` | `MYSQL_8_0` | **Critique** | Le point d'entrée construit toujours un DSN `mysql://`. Tout autre moteur (ou `NONE`) laisse Roundcube sans base de données utilisable. |
| `application_version` | Un tag `-apache` exact | Moyen | `latest` ou un tag `1.6.x-apache` glissant peut modifier le contenu sous la même chaîne de tag, ce qui ne produit pas de différence Terraform et pas de nouvelle révision — le conteneur en cours d'exécution conserve silencieusement l'ancienne image. Les variantes `-fpm` n'ont pas de serveur web. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et perd les préférences et contacts stockés. |
| `database_password_length` | Définir une fois, au premier déploiement | Élevé | Le modifier sur un déploiement en cours écrit un nouveau mot de passe que la base de données ne contient pas, et chaque connexion échoue jusqu'à ce que le job de base de données soit réexécuté. |
| `php_memory_limit` | `512M` ou plus | Moyen | La valeur par défaut de l'image est de 64 Mo ; les messages et pièces jointes volumineux sont les cas où un petit tas PHP s'épuise. |
| `admin_email`, `enable_gcs_storage_volume` | Laisser tel quel | Faible | Aucun n'a d'effet sur ce module, quelle que soit leur description. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid, y compris l'exécution de `installto.sh`, à la première requête après l'inactivité. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le formulaire de connexion est accessible publiquement sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Roundcube
est décrite dans **[Roundcube_Common](Roundcube_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Roundcube sur Cloud Run](../labs/Roundcube_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Roundcube Common — Configuration d'application partagée](Roundcube_Common.md) — la couche d'application sur laquelle ce module s'appuie.
