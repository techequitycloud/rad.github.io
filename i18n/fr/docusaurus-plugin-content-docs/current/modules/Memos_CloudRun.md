---
title: "Memos sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Memos sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Memos_CloudRun.md @ e69407af sha256:860ad7cb9216 -->

# Memos sur Google Cloud Run {#memos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_CloudRun.png" alt="Memos sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos est un service de prise de notes auto-hébergé, open source, sous licence
MIT, conçu pour la capture rapide de markdown — un seul binaire Go d'environ
20 Mo avec un frontend React. Ce module déploie Memos sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Memos et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que Memos coûte sur RAD, et comment cela se compare {#what-memos-costs-on-rad-and-how-that-compares}

**L'exécution de Memos dans votre propre projet GCP coûte environ 81,23 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure toutes les heures en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~81,23 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~32 crédits/jour, mesuré toutes les heures par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **81,23 $** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour Memos à comparer, donc la base de référence honnête est un VPS nu : une plus petite boîte suffit — Hetzner CX11 ou un Droplet DigitalOcean 1 vCPU/1-2 Go coûte **6-12 $/mois** — mais il faut toujours quelqu'un pour le patcher, le sauvegarder et le surveiller, ce que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes monétaires, et ne l'est généralement pas — pour un service de prise de notes personnel à faible trafic, le véritable argument est ce que RAD gère pour vous (sauvegardes, patching, secrets, surveillance) plutôt que le prix affiché.
- Dans tous les cas, il s'agit d'un service de prise de notes personnel à faible trafic, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre d'un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et
simplement le projet — la suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL,
aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de facturation,
puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer
que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau.
Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés
doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox
qui convient à la plupart des utilisations d'étude/démo). Google affirme que la
plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures
suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et la suppression logicielle de Cloud Storage est
explicitement désactivée pour ce bucket, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Memos
purement et simplement et de le redéployer plus tard. Un redéploiement coûte
à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits de
temps de build.

La suppression ne permet d'économiser de l'argent que si Memos devait rester
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution quotidien — par rapport au total du
projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie
du coût d'exécution ici est généralement la base de données et la VM de
fichier/cache partagée ; elles ne s'arrêtent que lorsque rien d'autre dans
le projet ne les utilise, donc la suppression de cette application pendant
que quelque chose d'autre partage le projet n'économise que la partie
calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez
la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant reçoit l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
  et règle directement avec le client. Si le portefeuille est faible, la facturation
  est interrompue et les données sont conservées, de sorte que personne ne reçoit
  de frais inattendus. À la fin, le partenaire transfère le projet et les
  déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Memos s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement
assemble un ensemble délibérément restreint de services Google Cloud — Memos
n'a pas de file d'attente, pas de cache et pas de workers en arrière-plan :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 512 Mio par défaut, autoscaling sans serveur, mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — ce module standardise sur Postgres via une seule URL de connexion `MEMOS_DSN` |
| Stockage de fichiers | Cloud Filestore (NFS) | `enable_nfs = true` par défaut, monté dans le répertoire de données de Memos `/var/opt/memos` — voir la note sur les pièces jointes ci-dessous |
| Cache et file d'attente | aucun | Memos n'a pas de dépendance de file d'attente ou de cache |
| Secrets | Secret Manager | Seul le mot de passe de la base de données (géré par la Fondation) ; Memos lui-même n'a pas de secret au niveau de l'application |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur standardisé.** `Memos_Common` corrige
  `database_type = "POSTGRES_15"`. Memos lui-même prend également en charge MySQL et SQLite
  en amont, mais ce module ne câble pas ces chemins.
- **Aucun secret d'amorçage administrateur n'existe.** Le **premier compte créé via l'interface
  utilisateur web devient l'hôte/administrateur** — il n'y a pas de variable d'environnement
  de type `DEFAULTUSER` et rien à récupérer de Secret Manager pour la première connexion.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Memos ne fait aucun travail sans une requête entrante, donc
  la facturation basée sur les requêtes est le bon défaut — contrairement aux applications avec
  des planificateurs en arrière-plan ou des push WebSocket, il n'y a aucune raison de forcer
  un CPU toujours actif ici.
- **Le DSN de la base de données est calculé au démarrage du conteneur**, non intégré à l'image.
  `memos-entrypoint.sh` lit les variables `DB_*` injectées par la plateforme et construit l'URL de
  connexion unique `MEMOS_DSN` que Memos attend, en fonction de si Cloud Run lui a fourni un
  répertoire de socket Unix ou un hôte TCP, et en encodant l'URL du mot de passe.
- **Les pièces jointes sont sur NFS par défaut.** Memos écrit les pièces jointes téléchargées
  sous forme de fichiers sous `/var/opt/memos/assets`, et non dans PostgreSQL. `enable_nfs = true` monte le
  volume Filestore partagé à `nfs_mount_path` (`/var/opt/memos`), de sorte que les pièces jointes
  survivent aux révisions et à la mise à l'échelle à zéro. Gardez NFS activé à moins que le
  déploiement ne soit en texte uniquement ; s'il est désactivé, les pièces jointes résident
  sur le système de fichiers éphémère du conteneur et sont perdues à chaque redémarrage.
- **L'inscription publique est ouverte par défaut**, comme toute nouvelle installation de Memos.
  Désactivez l'auto-inscription depuis l'interface utilisateur de Memos après avoir créé le
  premier compte (administrateur), si le déploiement ne doit pas accepter d'autres
  inscriptions publiques.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Memos {#a-cloud-run--the-memos-service}

Memos s'exécute comme un service Cloud Run v2 qui s'auto-adapte en fonction de la charge de requêtes
entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Memos stocke toutes les données d'application (notes, tags, utilisateurs, métadonnées de ressources)
dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le
**Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

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

### C. Secret Manager {#c-secret-manager}

Seul le secret du mot de passe de la base de données existe pour ce module — entièrement géré par la
Fondation, et non par `Memos_Common`. Memos génère sa propre clé de signature de session interne
et la stocke dans sa propre base de données au premier démarrage ; il n'y a pas d'entrée
Secret Manager correspondante à inspecter.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ;
les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec des tests de disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Memos {#3-memos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute
  `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se connecte via le Cloud
  SQL Auth Proxy et crée de manière idempotente le rôle et la base de données de l'application. Le
  job peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Memos applique sa propre configuration de schéma GORM
  auto-migrée interne à chaque démarrage — aucun job de migration séparé n'est nécessaire, et
  la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Aucune information d'identification d'amorçage administrateur à récupérer.** Le premier compte créé via
  le formulaire d'inscription de l'interface utilisateur web devient l'hôte/administrateur. Il n'y a rien dans
  Secret Manager à récupérer avant la première connexion — cela diffère de la plupart des applications de ce
  catalogue.
- **Le DSN de la base de données est calculé, non statique.** `memos-entrypoint.sh` construit
  `MEMOS_DSN` à partir de `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` au
  démarrage du conteneur (voir [Memos_Common](Memos_Common.md) pour la logique de branchement exacte),
  puis se connecte au point d'entrée de l'image amont, qui abandonne les privilèges à un utilisateur
  non root avant de lancer le binaire compilé.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — la page
  de connexion/d'accueil publique de Memos, accessible sans authentification. Aucun point de terminaison
  dédié `/health` ou `/healthz` n'est documenté en amont.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Memos sont listés ; toute autre entrée est
héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `memos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Memos` | Nom lisible par l'homme affiché dans la Console. |
| `application_description` | `Memos note-taking service on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de suivi du déploiement. `Memos_Common` mappe `"latest"` à l'argument de build Dockerfile `MEMOS_VERSION = "0.28.0"` épinglé, de sorte qu'un nouveau build ne résout jamais un tag amont `latest` inexistant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper avec le point d'entrée DSN calculé. `"prebuilt"` déploie directement l'image officielle mais nécessite ensuite de câbler manuellement `MEMOS_DRIVER`/`MEMOS_DSN` via `environment_variables`. |
| `container_image` | `ghcr.io/usememos/memos` | Référence de l'image de base utilisée par le build personnalisé. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance — suffisante pour l'empreinte mémoire réduite de Memos. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro — Memos n'a pas de travail en arrière-plan à maintenir au chaud. |
| `max_instance_count` | `1` | Valeur par défaut à instance unique ; augmentez pour une charge concurrente plus élevée. |
| `container_port` | `5230` | Port natif par défaut de Memos — aucune remappage effectué. |
| `execution_environment` | `gen2` | Gen2 est requis pour le montage NFS qui contient les pièces jointes. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — Memos ne fait aucun travail entre les requêtes. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Memos dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public ; Memos n'a pas de chemin d'ingestion non authentifié séparé à protéger. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'ensemble du service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Toute valeur `MEMOS_*` documentée par Memos peut être définie ici (par exemple `MEMOS_INSTANCE_URL`). La connexion à la base de données (`MEMOS_DSN`, `MEMOS_DRIVER`) est calculée automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé et NFS {#group-9--custom-sql--nfs}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`
exécutent du SQL à partir d'un bucket GCS après le provisionnement. `nfs_instance_name` /
`nfs_instance_base_name` sélectionnent le serveur NFS partagé dont le volume contient le
répertoire de données de Memos (voir Groupe 11). Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets` — vide par défaut, car les pièces jointes de Memos ne sont pas sauvegardées par GCS dans ce module. |
| `storage_buckets` | `[]` | Aucun bucket provisionné par défaut. |
| `enable_nfs` | `true` | Monte le volume NFS partagé à `nfs_mount_path` (`/var/opt/memos`), où Memos stocke les pièces jointes téléchargées. Le désactiver place les pièces jointes sur un disque éphémère. |
| `gcs_volumes` | `[]` | Non nécessaire pour les pièces jointes, qui sont sur NFS par défaut. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Memos_Common`. |
| `application_database_name` | `memos` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `memos` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Memos n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 30s de délai | Sonde de démarrage — cible la page de connexion publique. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring ; activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Memos n'a pas de dépendance de cache/file d'attente ; laissez `false` à moins d'intégrer une instance Redis externe à des fins personnalisées. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
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
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés — vides par défaut. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (inclut `db-init`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via
> le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs et
> les combinaisons au moment de la planification. Une configuration invalide fait échouer la
> **planification** avec une erreur claire et nommée avant la création de toute ressource,
> de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment
> de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| Premier compte créé via l'inscription | Créez-le immédiatement après le déploiement | Critique | Le **premier** compte à s'inscrire devient l'hôte/administrateur — s'il est laissé ouvert, tout visiteur qui atteint l'URL en premier revendique ce rôle. |
| Auto-inscription publique | Désactiver après le premier administrateur | Élevé | Memos est livré avec l'inscription ouverte par défaut ; le laisser activé permet à quiconque ayant l'URL de créer un compte. |
| `container_image_source` | `custom` (par défaut) | Élevé | `"prebuilt"` déploie directement l'image officielle, mais cette image n'a pas de logique pour calculer `MEMOS_DSN` à partir des variables `DB_*` de la plateforme — elle doit être câblée manuellement via `environment_variables` ou l'application ne parvient pas à se connecter à la base de données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_file` valide fait échouer le job d'importation. |
| `memory_limit` | `512Mi` (la valeur par défaut est suffisante) | Moyen | L'empreinte mémoire de Memos est faible ; l'augmentation de cette valeur affecte principalement le coût, pas la correction. |
| `min_instance_count` | `0` (par défaut) | Faible | La mise à l'échelle à zéro ajoute un bref démarrage à froid (binaire Go, démarrage rapide) à la première requête après l'inactivité — beaucoup plus court que les applications JVM/Node.js de ce catalogue. |
| `enable_nfs` pour les pièces jointes | Laisser `true` | Moyen | Avec NFS désactivé, les pièces jointes téléchargées résident sur le système de fichiers éphémère de Cloud Run et ne survivent pas à un redémarrage de révision ou à une mise à l'échelle à zéro — les notes textuelles dans PostgreSQL ne sont pas affectées. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le formulaire de connexion/inscription est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Memos
partagée avec la variante GKE est décrite dans
**[Memos_Common](Memos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Memos sur Cloud Run](../labs/Memos_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Memos sur GKE Autopilot](Memos_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Memos Common — Configuration d'application partagée](Memos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Connaissances personnelles et lecture**.
