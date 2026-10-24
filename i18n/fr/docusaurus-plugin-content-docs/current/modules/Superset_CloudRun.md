---
title: "Apache Superset sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Apache Superset sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Superset_CloudRun.md @ 1665a43e sha256:4011e6d0acf6 -->

# Apache Superset sur Google Cloud Run {#apache-superset-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Superset_CloudRun.png" alt="Apache Superset sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Apache Superset est une plateforme open source d'exploration et de visualisation de données
utilisée par des organisations du monde entier. Ce module déploie Superset sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Superset et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécaniques communes à toutes les applications Cloud Run — identité de service, ingress et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Coût de Superset sur RAD et comparaison {#what-superset-costs-on-rad-and-how-that-compares}

**Superset sur le module Cloud Run de RAD coûte environ 83,31 $ US par mois dans un projet Google Cloud que vous possédez, avec les frais de module facturés une seule fois en crédits RAD.** Pour un coût minimal, il reste sur Cloud Run, maintenu actif plutôt que mis à l'échelle à zéro, car les tableaux de bord sont généralement ouverts tout au long de la journée de travail ; GKE Autopilot ne vaut la peine que s'il doit coexister avec d'autres charges de travail Kubernetes — voir le [guide GKE](Superset_GKE.md) pour cette option, à environ 129,18 $ US par mois, avec des frais de module plus élevés pour correspondre à son pod par défaut plus grand. Si vous n'avez besoin de Superset qu'occasionnellement — un cycle de reporting, un essai analytique — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettre en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **83,31 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **37 crédits par jour**, soit environ 1 110 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2 vCPU / 2 GiB (actif) | 26,28 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **83,31 $ US** |

### Comparaison {#how-it-compares}

- **Preset**, la société d'hébergement géré fondée par le créateur de Superset, facture **20 $/utilisateur/mois facturés annuellement** (ou 25 $/utilisateur/mois mensuellement) sur son plan Professionnel pour un nombre illimité d'utilisateurs et d'espaces de travail, après un niveau Starter gratuit pour un maximum de 5 utilisateurs (source : [preset.io/pricing](https://preset.io/pricing/)). Une équipe de cinq analystes sur Preset Professional coûte entre 100 et 125 $/mois avant tout ajout ; le chiffre de RAD pour un projet propre est un coût d'infrastructure fixe qui ne varie pas avec les effectifs.
- Une comparaison autogérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — moins cher, mais Superset a également besoin d'une base de données gérée et de ses propres sauvegardes, que vous devriez alors gérer manuellement.
- La licence de Superset est gratuite dans tous les cas — la comparaison ici est entre l'hébergement géré par siège (Preset) et l'infrastructure fixe (RAD), et non le coût du logiciel.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Superset s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL ou la ressource de calcul un par un : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez créé des tableaux de bord ou enregistré des ensembles de données que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de restauration de 30 jours passée, l'alternative est de supprimer Superset purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 115 crédits (environ 11,50 $ US) dans votre propre projet, ou 104 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Superset reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 2,78 $ US par jour), cela représente environ 5 jours ou plus, ou environ 3 jours ou plus dans un projet géré par RAD (37 crédits par jour). La majeure partie du coût d'exécution ici est la base de données ; elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Superset alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [preset.io/pricing](https://preset.io/pricing/) pour les plans Superset hébergés de Preset.

## 1. Vue d'ensemble {#1-overview}

Superset s'exécute comme un conteneur Python/Gunicorn sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python/Gunicorn, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — stocke les tableaux de bord, les graphiques, les ensembles de données et les paramètres utilisateur |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Cache et requêtes asynchrones | Redis | Désactivé par défaut ; fortement recommandé pour les déploiements multi-utilisateurs en production |
| Secrets | Secret Manager | `SUPERSET_SECRET_KEY` et mot de passe de base de données auto-générés |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est requis.** Superset l'utilise comme base de données de métadonnées pour tous
  les tableaux de bord, graphiques, ensembles de données et définitions de rôles. MySQL n'est pas pris en charge.
- **`SUPERSET_SECRET_KEY` est auto-généré.** Une clé aléatoire de 50 caractères est générée
  et stockée dans Secret Manager. Elle signe les sessions Flask — sa rotation invalide toutes
  les sessions utilisateur actives. Traitez-la comme immuable après le premier déploiement.
- **L'initialisation en deux phases s'exécute automatiquement.** Un job `db-init` crée la
  base de données et l'utilisateur PostgreSQL ; puis un job `app-init` exécute les migrations de schéma et
  crée l'utilisateur administrateur. Les deux s'exécutent à chaque déploiement mais sont idempotents.
- **Redis est désactivé par défaut.** Sans Redis, les workers Celery n'ont pas de broker ;
  l'exécution de requêtes asynchrones et la mise en cache des tableaux de bord ne sont pas disponibles. Activez-le pour la production.
- La sonde de santé cible **`/health`** — le point de terminaison de disponibilité Gunicorn de Superset.
- **L'environnement d'exécution `gen2` est utilisé.** Requis pour une compatibilité Linux complète
  et, lorsque NFS est activé, les montages de volumes NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Superset {#a-cloud-run--the-superset-service}

Superset s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

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

Superset stocke toutes les métadonnées dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le
service se connecte en privé via le **Cloud SQL Auth Proxy** via un socket Unix
(pas d'IP publique). Lors du premier déploiement, le job `db-init` crée la base de données
et l'utilisateur de l'application, et le job `app-init` applique les migrations de schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement pour les exportations de données Superset,
les sorties de graphiques et les fichiers de rapport. Le compte de service se voit accorder l'accès
automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et CMEK.

### D. Cache Redis et moteur de requêtes asynchrones {#d-redis-cache-and-async-query-engine}

Redis sert de backend de mise en cache et de broker Celery pour Superset. Lorsqu'il est activé, il alimente
l'exécution SQL asynchrone, le préchauffage du cache des tableaux de bord et les rapports planifiés. Sans Redis,
toutes les requêtes s'exécutent de manière synchrone et bloquent les workers Gunicorn.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le `SUPERSET_SECRET_KEY` et le mot de passe de la base de données sont stockés dans Secret Manager et
injectés dans le service au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress
et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring. Un test de disponibilité contre `/health` est disponible mais désactivé par défaut
(`uptime_check_config.enabled = false`). Des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Superset {#3-superset-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` crée la base de données
  et l'utilisateur Superset de manière idempotente avant le démarrage du service. Il s'exécute avec `postgres:15-alpine`
  et arrête le sidecar Cloud SQL Auth Proxy via `quitquitquit` à la fin.
- **Migrations de schéma à chaque déploiement.** Le job `app-init` exécute `superset db upgrade`
  à chaque déploiement, appliquant toutes les modifications de schéma en attente. Il exécute ensuite
  `superset fab create-admin` pour créer ou mettre à jour l'utilisateur administrateur, et `superset init`
  pour charger les rôles et permissions par défaut. Le job `app-init` dépend de la réussite de `db-init`.
- **Séquence de démarrage.** Le job `app-init` a un délai d'attente de 30 minutes pour s'adapter aux migrations lentes
  lors de la première exécution. La sonde de démarrage HTTP (délai initial de 60 s, 12 seuils d'échec)
  donne au pool de workers Gunicorn jusqu'à 180 secondes pour démarrer.
- **Clé secrète Flask.** `SUPERSET_SECRET_KEY` signe les sessions Flask et chiffre
  les identifiants de connexion à la base de données stockés dans les métadonnées de Superset. La modifier après
  le premier déploiement invalide toutes les sessions et rend les identifiants stockés illisibles.
  La clé est auto-générée comme une chaîne aléatoire de 50 caractères dans Secret Manager.
- **Requêtes asynchrones et rapports planifiés.** Les workers Celery de Superset utilisent Redis comme
  broker et backend de résultats. Sans Redis, les requêtes asynchrones et les rapports planifiés ne sont pas
  disponibles. Configurez `enable_redis = true` et fournissez `redis_host` pour la production.
- **Chemin de santé.** Les sondes de disponibilité/vivacité ciblent `/health`, qui renvoie HTTP 200
  lorsque le pool de workers Gunicorn est prêt.
- **Inspecter les jobs en cours d'exécution :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les
paramètres spécifiques ou notables pour Superset sont listés ; toutes les autres entrées sont
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
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `superset` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Apache Superset` | Nom convivial affiché dans la console. |
| `application_description` | `Apache Superset - Data Exploration and Visualisation Platform` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Superset ; épingler à une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU et mémoire par instance ; 2 vCPU / 2 GiB minimum pour Superset. |
| `container_port` | `8088` | Superset/Gunicorn écoute sur le port 8088. |
| `container_image_source` | `custom` | `custom` construit le Dockerfile intégré (requis pour psycopg2) ; `prebuilt` utilise une image existante. |
| `execution_environment` | `gen2` | Génération Cloud Run ; la génération 2 est requise pour les montages NFS et l'amélioration du réseau. |
| `min_instance_count` | `1` | Instances minimales ; maintenez ≥ 1 pour éviter les retards de démarrage à froid (~30–60 s pour Superset). |
| `max_instance_count` | `5` | Instances maximales (plafond de coût). |
| `timeout_seconds` | `600` | Délai d'expiration des requêtes ; étendu pour les requêtes SQL de longue durée. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `traffic_split` | `[]` | Allocation de trafic canary/blue-green entre les révisions. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (tous / interne / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `SUPERSET_SECRET_KEY` est injecté automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé et NFS {#group-9--custom-sql--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. Superset ne nécessite pas NFS. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `enable_nfs` | `false` | Volume Filestore partagé. Superset ne nécessite pas NFS. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Superset nécessite PostgreSQL. |
| `application_database_name` | `superset_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `superset_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le pipeline intégré d'initialisation de la base de données en deux phases + initialisation de l'application. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler — utiles pour le préchauffage du cache ou la génération de rapports. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, 60 s de délai, 12 échecs | Permet jusqu'à 180 s pour l'initialisation du pool de workers Gunicorn. |
| `liveness_probe` / `health_check_config` | HTTP `/health`, 30 s de délai | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/health` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour Celery et la mise en cache. **Fortement recommandé pour la production.** |
| `redis_host` | `""` | Nom d'hôte ou IP de Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis (nombre dans la variante Cloud Run). |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SUPERSET_SECRET_KEY` (auto-généré) | immuable après le premier déploiement | Critique | La modification de la clé invalide toutes les sessions actives et rend les identifiants de connexion à la base de données stockés définitivement illisibles. |
| `database_type` | `POSTGRES_15` | Critique | Superset nécessite PostgreSQL ; la modification interrompt le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation supprime le sidecar Auth Proxy ; toutes les connexions PostgreSQL échouent. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les tableaux de bord et métadonnées. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `enable_redis` | `true` pour la production | Élevé | Sans Redis, les workers Celery n'ont pas de broker ; les requêtes asynchrones et les rapports planifiés ne sont pas disponibles. |
| `redis_host` | défini explicitement | Élevé | Requis lorsque `enable_redis = true` ; vide, les workers Celery échouent au démarrage. |
| `container_resources.memory_limit` | `2Gi` minimum | Élevé | En dessous de 1 GiB, les workers Gunicorn sont tués par manque de mémoire pendant l'exécution des requêtes. |
| `container_resources.cpu_limit` | `2000m` | Élevé | En dessous de 1000m, le job de migration d'initialisation de l'application peut expirer dans sa fenêtre de 30 minutes. |
| `min_instance_count` | `1` | Élevé | `0` ajoute une latence de démarrage à froid et risque de manquer des travaux asynchrones ; Superset prend 30 à 60 s pour démarrer. |
| `startup_probe.failure_threshold` | `12` ou plus | Élevé | Une réduction trop importante entraîne l'arrêt du conteneur par Cloud Run avant que Superset ne termine les migrations de base de données. |
| `application_version` | épingler à une version spécifique | Moyen | `latest` déclenche des mises à niveau incontrôlées qui peuvent introduire des changements d'API incompatibles. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans eux, le formulaire de connexion Superset est publiquement accessible. |
| `timeout_seconds` | `600` | Moyen | Une réduction en dessous de 120 s entraîne l'interruption des requêtes analytiques de longue durée en cours d'exécution. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Superset partagée
avec la variante GKE est décrite dans **[Superset_Common](Superset_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Superset sur Cloud Run](../labs/Superset_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Apache Superset sur GKE Autopilot](Superset_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Superset Common — Configuration d'application partagée](Superset_Common.md) — la configuration partagée par les deux cibles de déploiement.
