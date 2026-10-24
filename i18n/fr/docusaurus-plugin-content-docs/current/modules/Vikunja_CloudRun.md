---
title: "Vikunja sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Vikunja sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Vikunja_CloudRun.md @ 1665a43e sha256:5ac3a0760bf3 -->

# Vikunja sur Google Cloud Run {#vikunja-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vikunja_CloudRun.png" alt="Vikunja sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vikunja est une application open source, auto-hébergée de gestion de tâches et de
projets — listes, tableaux kanban, diagrammes de Gantt, calendriers, rappels et
partage d'équipe via une API REST et une interface utilisateur web. Ce module
déploie Vikunja sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Vikunja et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Vikunja sur RAD, et comment cela se compare {#what-vikunja-costs-on-rad-and-how-that-compares}

**L'exécution de Vikunja sur Cloud Run dans votre propre projet Google Cloud coûte environ 115,17 $ US/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits (7,50 $ US) facturé une fois au moment du déploiement. Vikunja est une application auto-hébergée de gestion de tâches et de projets, et elle s'exécute `alwaysOn` par défaut afin que les listes, les tableaux kanban et les rappels restent réactifs sans démarrage à froid — ce qui représente la majeure partie de ce coût d'exécution. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous — ou voir le [guide GKE](Vikunja_GKE.md) pour une alternative moins chère.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 115,17 $ US/mois, facturé par Google au prix catalogue | ~54 crédits/jour (environ 1620/mois, 162 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un abonnement mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 Gio (alwaysOn) | 44,72 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **115,17 $ US** |

### Comment cela se compare {#how-it-compares}

- Les frais de Vikunja Cloud hébergé par utilisateur : Personnel est de 4 €/mois (utilisateur unique), Famille est de 10 €/mois pour jusqu'à 5 utilisateurs, et Organisation est de 5 €/mois par utilisateur pour les équipes — vérifié sur la page de tarification de Vikunja, le 8 octobre 2026. Une équipe de 5 personnes sur le plan Famille coûte 10 €/mois (environ 11 $), bien en dessous du coût d'exécution du projet propre de RAD ici ; l'hébergement propre de Vikunja Cloud est vraiment bon marché car il s'agit d'un service multi-locataire partagé, tandis que RAD vous offre un projet dédié et isolé.
- Une comparaison avec un VPS auto-géré, dimensionné par défaut à 1 vCPU / 0,5 Gio de Vikunja : un Hetzner CPX11 ou un DigitalOcean 1 vCPU/2 Go Droplet coûte environ 6-12 $/mois — moins cher en termes de trésorerie, plus votre propre temps pour les sauvegardes et les correctifs Postgres, que le Cloud SQL géré et Secret Manager de RAD couvrent pour vous.
- Pour un utilisateur unique ou un petit foyer, les plans cloud de Vikunja sont l'option la moins chère en termes de trésorerie ; le cas de RAD ici est un projet dédié que vous contrôlez entièrement, pas le prix d'autocollant le plus bas.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
dissociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — il s'agit d'une vérification, pas d'une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique
de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Vikunja et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources pour de bon, et le fait de ramener Vikunja signifie un redéploiement à partir de
zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou environ
70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Vikunja restait inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — environ 2 jours ou plus dans votre propre projet
(environ 3,84 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD
(54 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les revendications de pause/restauration ; [Tarification de Vikunja](https://vikunja.io/pricing/).

## 1. Vue d'ensemble {#1-overview}

Vikunja s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 512 Mio par défaut, instance unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Vikunja ne prend pas en charge MySQL dans ce module |
| Build de conteneur | Cloud Build + Artifact Registry | Enveloppe l'image amont `scratch` avec un busybox greffé |
| Secrets | Secret Manager | `VIKUNJA_SERVICE_JWTSECRET` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage.
- **L'application se connecte via l'IP privée de Cloud SQL, pas le socket.** Vikunja
  construit une URL `postgres://` en interne, et les deux-points du chemin du socket
  Auth Proxy interrompent l'analyse de l'URL. Le point d'entrée se connecte via
  l'IP privée avec `sslmode=require`.
- **L'image est basée sur `scratch` et reçoit une greffe busybox.** L'image
  amont `vikunja/vikunja` n'a pas de shell, donc le build personnalisé copie un busybox
  statique pour exécuter le point d'entrée. `container_image_source` par défaut à `"custom"`.
- **`VIKUNJA_SERVICE_JWTSECRET` est généré automatiquement** et stocké dans Secret Manager.
  Le faire pivoter après le premier démarrage invalide toutes les sessions
  utilisateur actives.
- **`cpu_always_allocated = true` par défaut.** Vikunja exécute un planificateur de rappels/cron
  intégré qui doit s'exécuter sans requête entrante, de sorte que le CPU n'est
  pas limité entre les requêtes. Cela maintient une seule instance chaude.
- **Instance unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`). Vikunja n'a pas de
  coordination intégrée pour plusieurs instances concurrentes.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que l'interface utilisateur et
  l'API soient accessibles. Activez IAP pour exiger la connexion Google.
- **NFS est activé par défaut et doit le rester.** Les tâches, projets et
  utilisateurs vivent dans PostgreSQL ; les pièces jointes des tâches sont des
  fichiers, et le wrapper pointe Vikunja vers le montage NFS (`VIKUNJA_FILES_BASEPATH` =
  `nfs_mount_path`, `/data`) afin qu'elles survivent aux redémarrages.
- **`VIKUNJA_SERVICE_PUBLICURL` est défini à l'exécution** à partir de l'URL réelle
  `CLOUDRUN_SERVICE_URL`, de sorte que les liens et le frontend utilisent toujours l'URL
  réelle du service.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Vikunja {#a-cloud-run--the-vikunja-service}

Vikunja s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Vikunja stocke toutes les données d'application (tâches, projets, tableaux,
utilisateurs, équipes) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le
job `db-init` se connecte via le **Cloud SQL Auth Proxy** sur un socket Unix ;
l'application en cours d'exécution se connecte via l'**IP privée** de Cloud SQL
avec `sslmode=require` (son constructeur d'URL ne peut pas utiliser le chemin du socket).
Aucune IP publique n'est exposée.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
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

### C. Cloud Build et Artifact Registry {#c-cloud-build--artifact-registry}

Étant donné que l'image Vikunja amont est basée sur `scratch`, le module construit
une image wrapper via Cloud Build (en greffant un busybox statique et le point
d'entrée) et la pousse vers Artifact Registry.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `VIKUNJA_SERVICE_JWTSECRET` (utilisé pour signer les JWT de session utilisateur). Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cloud Storage et pièces jointes {#e-cloud-storage--file-attachments}

Le répertoire de pièces jointes par défaut de Vikunja (`/app/vikunja/files`) est éphémère sur
Cloud Run, donc le module monte NFS à `nfs_mount_path` (`/data`) et définit
`VIKUNJA_FILES_BASEPATH` sur ce chemin ; les pièces jointes sont durables par défaut. Le module
ne déclare aucun bucket GCS dédié par défaut.

- **Console :** Filestore / Compute Engine (VM NFS) lorsque `enable_nfs = true`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options NFS et GCS Fuse.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la
connectivité (l'application atteint Cloud SQL via l'egress VPC de plage privée).

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Vikunja {#3-vikunja-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données et le
  rôle de l'application, et accorde les privilèges. Le job peut être réexécuté
  en toute sécurité.
- **Migrations de schéma au démarrage.** Vikunja applique ses propres migrations
  de schéma automatiquement au premier démarrage de l'application — le job
  `db-init` ne provisionne qu'une base de données vide, donc prévoyez un temps
  supplémentaire pour que la première révision devienne saine.
- **`VIKUNJA_SERVICE_JWTSECRET` est immuable après le premier démarrage.** Il est généré une fois
  et écrit dans Secret Manager. Le modifier invalide toutes les sessions
  utilisateur actives. Ne le faites pivoter que pendant une fenêtre de
  maintenance planifiée.
- **Le premier compte enregistré devient le propriétaire.** Vikunja n'est pas
  livré avec un administrateur pré-initialisé. Ouvrez `$SERVICE_URL` et
  enregistrez-vous — le premier compte est propriétaire de l'instance. Ensuite,
  désactivez l'enregistrement ouvert :
  ```bash
  # add VIKUNJA_SERVICE_ENABLEREGISTRATION="false" to environment_variables and Update
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/health` — un point de terminaison public, non authentifié, qui renvoie 200
  une fois que le serveur a lié son port.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Vikunja sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `vikunja` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Vikunja` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Vikunja task manager on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Vikunja ; `latest` construit une version récente épinglée (`2.3.0`). |
| `application_database_name` | `vikunja` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `vikunja` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit le wrapper greffé busybox via Cloud Build ; `prebuilt` déploie l'image officielle. |
| `container_image` | `vikunja/vikunja` | Image amont que le build personnalisé enveloppe. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance ; gen2 impose un minimum de 512 Mio. |
| `container_port` | `3456` | Port sur lequel le serveur Go de Vikunja écoute. |
| `min_instance_count` | `1` | Maintenu à 1 pour que le planificateur de rappels reste chaud. |
| `max_instance_count` | `1` | Instance unique — Vikunja n'a pas de coordination multi-instances. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué afin que le planificateur de rappels intégré s'exécute entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 requis pour le minimum de 512 Mio et les montages NFS/GCS. |
| `enable_cloudsql_volume` | `true` | Socket Auth Proxy pour le job `db-init` ; l'application elle-même utilise l'IP privée. |
| `enable_image_mirroring` | `true` | Miroir l'image du wrapper dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public pour l'interface utilisateur/API. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC (atteint l'IP privée de Cloud SQL). |
| `enable_iap` | `false` | Exiger la connexion Google devant Vikunja. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `VIKUNJA_*` supplémentaires (par exemple `VIKUNJA_SERVICE_ENABLEREGISTRATION`). Ne pas définir `VIKUNJA_DATABASE_*` ou `VIKUNJA_SERVICE_JWTSECRET` ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement.

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
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vikunja ne déclare aucun bucket par défaut. |
| `enable_nfs` | `true` | Doit rester `true` : les pièces jointes sont écrites sur le montage NFS (`VIKUNJA_FILES_BASEPATH`). |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Mot de passe de la base de données {#group-12--database-password}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` délai de 30s | Sonde de démarrage ; large fenêtre de réessai pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/health` délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/health` | Vérification de la disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
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
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `VIKUNJA_SERVICE_JWTSECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate pour tout le monde. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_nfs` | `true` (par défaut) | Élevé | Sans NFS, les pièces jointes vivent sur un disque éphémère et sont perdues à chaque révision/redémarrage. |
| `memory_limit` | `512Mi` (minimum gen2) | Élevé | Les valeurs inférieures à 512 Mio sont rejetées au moment de la planification sur gen2. |
| `cpu_always_allocated` | `true` | Moyen | Passer à `false` met en pause le planificateur de rappels intégré pendant que l'instance est inactive — les rappels ne se déclencheront pas avant la prochaine requête. |
| `container_image_source` | `custom` | Élevé | `prebuilt` déploie l'image `scratch` brute sans mappage shell/point d'entrée — le conteneur ne peut pas mapper `DB_*` et ne parvient pas à se connecter. |
| `ingress_settings` | `all` | Moyen | `internal` rend l'interface utilisateur/API inaccessible depuis l'extérieur du VPC. |
| `enable_iap` | activer pour les instances privées | Moyen | Sans IAP, l'interface utilisateur est publique ; toute personne ayant l'URL peut accéder à la page de connexion/inscription. |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` (variable d'environnement) | `"false"` après le premier administrateur | Élevé | Laisser l'inscription ouverte permet à toute personne ayant l'URL de créer un compte. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à Vikunja partagée avec la variante GKE est décrite dans
**[Vikunja_Common](Vikunja_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Vikunja sur Cloud Run](../labs/Vikunja_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Vikunja sur GKE Autopilot](Vikunja_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vikunja Common — Configuration d'application partagée](Vikunja_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Mattermost sur Google Cloud Run](Mattermost_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **Espace de travail d'équipe**.
