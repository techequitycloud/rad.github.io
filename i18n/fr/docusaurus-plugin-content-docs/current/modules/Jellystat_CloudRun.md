---
title: "Jellystat sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Jellystat sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Jellystat_CloudRun.md @ e69407af sha256:4757955f0dcb -->

# Jellystat sur Google Cloud Run {#jellystat-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellystat_CloudRun.png" alt="Jellystat sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Jellystat](https://github.com/CyferShepard/Jellystat) est un tableau de bord
open source de statistiques et d'analyse pour les serveurs multimédia
[Jellyfin](https://jellyfin.org/), qui suit l'historique de lecture, les
sessions actives, l'activité des utilisateurs, la croissance de la
bibliothèque et les tendances de visionnage. Ce module déploie Jellystat sur
**Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Jellystat et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Jellystat sur RAD, et comment cela se compare {#what-jellystat-costs-on-rad-and-how-that-compares}

**Jellystat sur le module Cloud Run de RAD coûte environ 68 $ US par mois dans votre propre projet, plus des frais de module de 40 crédits (4 $ US) une fois par déploiement.** La majeure partie de ce coût est due à la base de données PostgreSQL dont il a besoin pour conserver l'historique de lecture de votre Jellyfin. Si vous n'en avez besoin que lorsque vous ajustez activement votre serveur multimédia, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre cet historique. Jellystat est également livré sous forme de module GKE, qui coûte plus cher ici (environ 93 $ US/mois) — Cloud Run est le choix le moins cher, sauf si vous utilisez déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **67,80 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 67,80 $ US** |

### Comment cela se compare {#how-it-compares}

- Jellystat est un tableau de bord d'analyse complémentaire pour un serveur Jellyfin que vous utilisez déjà, et non un produit avec son propre plan hébergé, il n'y a donc rien à comparer directement.
- Son empreinte est légère (1 vCPU, 0,5–1 GiB), donc un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (environ 24 $/mois) est plus que suffisant à lui seul — la majeure partie du coût de ce module est en fait la base de données PostgreSQL dont il a besoin pour conserver l'historique de lecture, qu'un VPS nu vous obligerait également à exécuter et à sauvegarder vous-même.
- Parce que Jellystat est généralement déployé aux côtés de Jellyfin dans le même projet, la base de données ici peut être le seul coût véritablement nouveau de son ajout — il vaut la peine de vérifier si votre déploiement Jellyfin a déjà une base de données vers laquelle vous pourriez le pointer au lieu d'en provisionner une seconde.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Jellystat s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression de Jellystat en tant que module unique, cela ne démantèle pas le service Cloud Run/GKE, la base de données Cloud SQL et le réseau un par un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart utilisent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. L'exportation nocturne de sa base de données par Jellystat est conservée dans ce bucket ; pour une installation par défaut, c'est la seule copie de vos données d'historique de visionnage qui vaille la peine d'être conservée.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli consiste à supprimer Jellystat purement et simplement et à le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si Jellystat devait autrement rester inutilisé pendant environ 2 jours ou plus dans votre propre projet (environ 2 jours ou plus dans un projet géré par RAD). La base de données PostgreSQL représente la majeure partie du coût d'exécution ici, donc la suppression de Jellystat seul permet d'économiser la totalité de la facture ci-dessus, à moins que quelque chose d'autre dans le projet ne la partage.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Jellystat s'exécute en tant que conteneur Node.js/Express unique (avec un
frontend React intégré) sur Cloud Run v2. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 Mio par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — noms de variables d'environnement `POSTGRES_*` non standard |
| Stockage d'objets | Cloud Storage | Un petit bucket `backups` facultatif pour les archives d'exportation de base de données |
| Secrets | Secret Manager | `JWT_SECRET` généré automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée.
- **Noms de variables d'environnement de base de données non standard.**
  Jellystat lit `POSTGRES_IP`, `POSTGRES_PORT`, `POSTGRES_USER`,
  `POSTGRES_PASSWORD` et `POSTGRES_DATABASE` — **pas** `POSTGRES_DB`
  (confirmé par la communauté que ce nom ne fonctionne pas), et pas les noms
  génériques de la plateforme `DB_*`. Les deux ensembles sont injectés
  côte à côte via l'alias `main.tf` de `db_*_env_var_name`.
- **`container_port = 3000` est fixe.** Le serveur de Jellystat code en dur ce port ; il
  n'est pas configurable via une variable d'environnement (voir le problème
  amont #314). La variable existe uniquement pour la parité de convention de
  la fondation.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il
  signe les jetons de session/authentification de Jellystat.
- **Pas de prise en charge de Redis.** Jellystat n'a pas d'intégration Redis
  native ; `enable_redis` et les variables associées sont inertes.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les
  démarrages à froid ajoutent quelques secondes de latence à la première
  requête après l'inactivité.
- **Aucune variable d'environnement ne couple Jellystat avec un serveur
  Jellyfin.** C'est le fait opérationnel le plus important de ce module : la
  connexion Jellyfin de Jellystat (URL du serveur + clé API) est entièrement
  saisie via son propre interface utilisateur web après le premier démarrage,
  et n'a pas d'équivalent automatisable par Terraform. Voir le §3 ci-dessous.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Jellystat {#a-cloud-run--the-jellystat-service}

Jellystat s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement à la charge de requêtes entre le nombre minimal et maximal
d'instances.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Jellystat stocke toutes les données de lecture/analyse dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le **proxy
d'authentification Cloud SQL** sur un socket Unix. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de
l'application. Jellystat applique ensuite ses propres migrations de schéma
automatiquement au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot
de passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un petit bucket **Cloud Storage** facultatif (`backups`) est provisionné pour la
fonctionnalité d'exportation/archivage de sauvegarde de base de données de
Jellystat.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `JWT_SECRET` (utilisé pour signer les jetons de session/authentification
Jellystat). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests
de disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Jellystat {#3-jellystat-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` à l'aide de `postgres:15-alpine`. Il se connecte via
  le proxy d'authentification Cloud SQL et crée de manière idempotente le rôle
  et la base de données de l'application. Le job peut être réexécuté en toute
  sécurité.
- **Migrations de base de données au démarrage.** Jellystat applique ses
  propres migrations de schéma automatiquement à chaque démarrage — aucun job
  de migration séparé n'existe dans ce module.
- **`JWT_SECRET` est généré une fois et stocké dans Secret Manager.** Le faire
  tourner invalide toutes les sessions utilisateur actives (les utilisateurs
  doivent se reconnecter) mais ne cause aucune perte de données.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de
  disponibilité ciblent `GET /auth/isConfigured` — un point de terminaison public, non
  authentifié, qui renvoie 200 dès que le serveur est opérationnel.
- **Le couplage manuel de Jellyfin est requis après le premier démarrage —
  cela ne peut pas être automatisé par Terraform.** Jellystat n'a pas de
  variable d'environnement pour l'URL ou la clé API du serveur Jellyfin
  compagnon ; le couplage est entièrement piloté par l'interface utilisateur :
  1. Ouvrez l'URL Jellystat déployée et créez le premier compte
     administrateur.
  2. Dans le tableau de bord de votre serveur Jellyfin → Clés API, générez
     une nouvelle clé API pour Jellystat.
  3. Dans les paramètres de Jellystat, entrez l'URL de votre serveur Jellyfin
     et collez cette clé API.
  Si vous n'avez pas encore de serveur Jellyfin déployé, déployez-en un
  d'abord avec le module frère **Jellyfin_CloudRun** (ou
  **Jellyfin_GKE**) — voir son propre guide de configuration.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Jellystat sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `jellystat` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Jellystat` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image conteneur — transmis au tag d'image `cyfershepard/jellystat`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `cyfershepard/jellystat`. Ne pas définir `custom` — il n'y a pas de Dockerfile pour cette application. |
| `container_image` | `""` | Laissez vide pour utiliser l'image par défaut. |
| `container_port` | `3000` | Fixe — correspond au port interne codé en dur de Jellystat. La modification de cette variable n'a aucun effet sur l'application. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Ressources du conteneur. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Mise à l'échelle à zéro par défaut. |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions socket. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé — Jellystat n'a pas besoin de stockage de fichiers partagés. |
| `create_cloud_storage` | `true` | Crée le petit bucket `backups`. |
| `gcs_volumes` | `[]` | Non utilisé par défaut. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe. |
| `application_database_name` | `jellystat_db` | Injecté à la fois comme `DB_NAME` et `POSTGRES_DATABASE`. Immuable après le premier déploiement. |
| `application_database_user` | `jellystat_user` | Injecté à la fois comme `DB_USER` et `POSTGRES_USER`. |
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/auth/isConfigured` | Point de terminaison de santé public, non authentifié. |
| `uptime_check_config` | `{ enabled = false, path = "/auth/isConfigured" }` | Activez explicitement pour activer. |

### Groupe 21 — Redis (non consommé) {#group-21--redis-not-consumed}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | désactivé / vide | **Non consommé.** Jellystat n'a pas d'intégration Redis native. |

Toutes les autres entrées sont héritées de [App_CloudRun.md](App_CloudRun.md)
avec un comportement standard.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (`backups`). |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `uptime_check_names` | État de la surveillance et tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `JWT_SECRET` (généré automatiquement) | Ne faire tourner que délibérément | Moyen | Le faire tourner invalide toutes les sessions actives — les utilisateurs doivent se reconnecter — mais ne cause aucune perte de données. |
| `container_image_source` | `prebuilt` | Critique | La définition de `custom` échoue à l'étape Cloud Build — il n'y a pas de Dockerfile pour Jellystat dans ce catalogue. |
| `container_port` | `3000` (informationnel) | Faible | Le serveur de Jellystat code en dur le port 3000 quelle que soit la valeur de cette variable. |
| Couplage URL/clé API Jellyfin | Manuel, post-déploiement | Élevé | Il n'y a pas de variable d'environnement pour cela — ignorer l'étape manuelle de l'interface utilisateur laisse Jellystat sans données même si le déploiement est sain. |
| `enable_redis` | laisser `false` | Faible | Jellystat n'a pas d'intégration Redis ; la définition de `true` n'a aucun effet. |
| `startup_probe`/`liveness_probe` chemin | `/auth/isConfigured` | Élevé | Pointer les sondes vers un point de terminaison authentifié provoque des 401/403 et la révision ne devient jamais prête. |
| `min_instance_count` | `0` (par défaut) est suffisant | Faible | Jellystat est un tableau de bord de requête/réponse sans planificateur d'arrière-plan — pas besoin de CPU toujours actif. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Jellystat partagée avec la variante GKE est décrite
dans **[Jellystat_Common](Jellystat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jellystat sur Cloud Run](../labs/Jellystat_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Jellystat sur GKE Autopilot](Jellystat_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Jellystat Common — Configuration d'application partagée](Jellystat_Common.md) — la configuration partagée par les deux cibles de déploiement.
