---
title: "ToolJet sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de ToolJet sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ToolJet_CloudRun.md @ 1665a43e sha256:b6ef6fe2b02c -->

# ToolJet sur Google Cloud Run {#tooljet-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_CloudRun.png" alt="ToolJet sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet est une plateforme open source à code réduit pour la création et le
déploiement d'outils internes — tableaux de bord, panneaux d'administration,
applications CRUD et workflows — avec un constructeur par glisser-déposer sur
vos propres bases de données et API. Ce module déploie ToolJet sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par ToolJet et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, entrée et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte ToolJet sur RAD, et comment cela se compare {#what-tooljet-costs-on-rad-and-how-that-compares}

**L'exécution de ToolJet sur Cloud Run dans votre propre projet Google Cloud
coûte environ 180,87 $ US/mois en frais Google Cloud**, en plus d'un frais de
module RAD unique de 300 crédits (30 $ US) facturé une seule fois au moment du
déploiement. ToolJet assemble une pile complète d'outils internes basée sur
Postgres — une base de données plus un serveur de fichiers NFS partagé pour les
téléchargements — de sorte que son coût d'exécution est supérieur à celui d'une
application sans état. Dans un projet géré par RAD, les frais de module
descendent à 270 crédits (10 % de moins) et le coût d'exécution est mesuré
horairement en crédits au lieu d'être facturé directement par Google — voir
[Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous — ou consultez le [guide GKE](ToolJet_GKE.md) si vous préférez
l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 300 crédits | 270 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 180,87 $ US/mois, facturé par Google au prix catalogue | ~83 crédits/jour (environ 2490/mois, 249 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan
mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (toujours actif) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **180,87 $ US** |

### Comment cela se compare {#how-it-compares}

- **ToolJet Cloud** hébergé par ToolJet facture par siège de **constructeur** :
  Basic est à 23 $/constructeur/mois (facturé annuellement), Pro est à 79
  $/constructeur/mois, et Team — son niveau le plus populaire — est à 199
  $/constructeur/mois, avec Enterprise sur devis — vérifié sur la page de
  tarification de ToolJet, le 8 octobre 2026. Une équipe de trois constructeurs
  sur le plan Team coûte 597 $/mois ; le coût d'exécution du projet propre de
  RAD est un forfait d'environ 181 $ US/mois, quel que soit le nombre de
  personnes qui créent des applications.
- Une comparaison autogérée, dimensionnée au-dessus de la classe micro-VPS
  habituelle pour la configuration par défaut de ToolJet de 2 vCPU / 4 GiB : un
  GCP Compute Engine `e2-standard-4` (4 vCPU/16 Go) coûte environ 98 $/mois à lui seul,
  avant une instance Postgres gérée — plus votre propre temps pour les
  sauvegardes, les correctifs et le renouvellement des certificats, que Cloud
  SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes
  monétaires. L'avantage de RAD est ce qui est géré pour vous, plus la capacité
  de mettre ToolJet en pause gratuitement plutôt que de payer pour une capacité
  inactive (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer complètement le projet — la
suppression logicielle récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne démantèle **pas** Cloud SQL, aucune VM,
ni la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3
déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
niveau sandbox que la plupart des utilisations d'étude/démo conviennent).
Google indique que la plupart des services fonctionnent à nouveau pleinement
dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé ToolJet et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les
ressources définitivement, et ramener ToolJet signifie redéployer à partir de
zéro. Cela coûte environ 303-306 crédits dans votre propre projet, ou environ
273-276 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si ToolJet reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son
propre coût d'exécution — environ 5 jours ou plus dans votre propre projet
(environ 6,03 $ US par jour), ou environ 3 jours ou plus dans un projet géré par
RAD (83 crédits par jour).

Gardez les données d'abord : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, de sorte que personne
ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les
déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration ; [tarification de ToolJet](https://www.tooljet.com/pricing).

## 1. Vue d'ensemble {#1-overview}

ToolJet s'exécute comme un conteneur NestJS + React unique sur Cloud Run v2 —
l'API backend et le client compilé sont servis à partir du même processus
(`SERVE_CLIENT = "true"`) sur le port 80. Le déploiement relie un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut ; `min_instance_count = 1` maintient le worker en cours d'exécution à chaud |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — **deux** bases de données sur une instance (métadonnées + base de données ToolJet) |
| Base de données ToolJet | PostgREST (sidecar in-pod) | Sert la deuxième base de données (`<service_name>_tjdb`) aux requêtes d'application ; signé avec `PGRST_JWT_SECRET` |
| Cache et file d'attente | Redis | Activé par défaut ; prend en charge les files d'attente BullMQ de ToolJet ; la VM NFS co-héberge Redis lorsque `redis_host` est vide |
| Secrets | Secret Manager | `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  interrompt le démarrage.
- **Deux bases de données sont créées.** Le job `db-init` du premier déploiement
  crée la base de données de métadonnées et la deuxième "base de données
  ToolJet" (`<service_name>_tjdb`), et accorde l'attribut **`CREATEROLE`** au rôle
  d'application partagé (ToolJet crée un rôle par espace de travail pour
  l'accès PostgREST).
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée du
  conteneur exécute `npm run db:migrate:prod` (TypeORM) **avant** de lancer le serveur —
  `start:prod` de ToolJet ne migre pas seul.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont générés
  automatiquement** et stockés dans Secret Manager. Ces clés ne doivent jamais
  être renouvelées après le premier démarrage — la rotation de `LOCKBOX_MASTER_KEY` rend
  chaque identifiant de source de données stocké indéchiffrable, et la rotation
  de `SECRET_KEY_BASE` invalide toutes les sessions.
- **Redis est activé par défaut** (`enable_redis = true`) et, avec un `redis_host` vide, la
  fondation injecte l'adresse IP de la VM du serveur NFS comme `REDIS_HOST`
  (`enable_nfs = true` provisionne cette VM).
- **Toujours actif, min=1.** ToolJet exécute un worker d'arrière-plan
  intégré, de sorte que `cpu_always_allocated = true` et `min_instance_count = 1` maintiennent une instance à
  chaud.
- **L'inscription est désactivée par défaut.** `DISABLE_SIGNUPS = "true"` est activé ; la
  première exécution est un **assistant de configuration** qui crée
  l'utilisateur administrateur initial et l'espace de travail.
- **Entrée publique par défaut.** `ingress_settings = "all"` pour que l'interface utilisateur du
  constructeur et tous les webhooks d'application soient accessibles ;
  l'activation d'IAP restreint l'accès aux identités Google.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de service et de ressource sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service ToolJet {#a-cloud-run--the-tooljet-service}

ToolJet s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge de requêtes entre le nombre minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

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

### B. Cloud SQL pour PostgreSQL 15 — deux bases de données {#b-cloud-sql-for-postgresql-15--two-databases}

ToolJet stocke toutes les données d'application — applications, configurations
de sources de données, utilisateurs, espaces de travail, sessions — dans une
instance Cloud SQL pour PostgreSQL 15 gérée, et utilise une **deuxième base de
données** (`<service_name>_tjdb`) sur la même instance pour la fonctionnalité intégrée de
base de données ToolJet. Le service se connecte en privé via le **proxy
d'authentification Cloud SQL** sur un socket Unix ; aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée les deux
bases de données, le rôle partagé `CREATEROLE`, l'extension `pgcrypto` et un
schéma `postgrest` appartenant à l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<service_name>_tjdb --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Redis (file d'attente et cache) {#c-redis-queue--cache}

Redis est **activé par défaut** et prend en charge les files d'attente BullMQ
de ToolJet (jobs d'arrière-plan, notifications et éditeur multijoueur). Lorsque
`redis_host` est laissé vide et `enable_nfs = true`, l'adresse IP privée de la VM du
serveur NFS est injectée comme `REDIS_HOST` ; définissez `redis_host`
explicitement pour pointer vers une instance Memorystore à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the injected host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `SECRET_KEY_BASE` (signe les sessions), `LOCKBOX_MASTER_KEY` (chiffre
toutes les informations d'identification de source de données stockées) et
`PGRST_JWT_SECRET` (signe les JWT PostgREST internes). Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'entrée et de sortie VPC contrôlent
la connectivité. `TOOLJET_HOST` (qui pilote les liens générés et les URI de
redirection OAuth) utilise par défaut l'URL de service calculée et peut être
remplacé via `environment_variables` pour un domaine personnalisé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Storage et NFS {#f-cloud-storage--nfs}

ToolJet stocke les applications, les configurations de sources de données et les
téléchargements dans PostgreSQL, donc **aucun bucket de données n'est
provisionné**. NFS est activé par défaut uniquement parce que sa VM co-héberge
Redis lorsque `redis_host` est vide ; le conteneur ToolJet lui-même est sans état.

- **Console :** Cloud Storage → Buckets ; Compute Engine → Instances de VM
  (serveur NFS).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des stratégies d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application ToolJet {#3-tooljet-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le proxy d'authentification Cloud SQL et crée de manière
  idempotente la base de données de métadonnées et la base de données ToolJet,
  le rôle partagé `CREATEROLE`, accorde `cloudsqlsuperuser`, pré-crée
  `pgcrypto` et réinitialise le schéma `postgrest` comme appartenant à
  l'application. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent avant le démarrage du serveur.** `cloud-entrypoint.sh`
  exécute `npm run db:migrate:prod` (TypeORM `migration:run`) en premier. `start:prod` de
  ToolJet est littéralement `node dist/src/main` et ne migre **pas** — sans l'étape
  explicite, la base de données de métadonnées reste vide et chaque action
  basée sur la base de données échoue (`relation "user_sessions" does not exist`). Le budget de la sonde de
  démarrage (30 × 15 s) absorbe cela au premier démarrage.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont immuables
  après le premier démarrage.** La modification de `LOCKBOX_MASTER_KEY` corrompt
  définitivement toutes les informations d'identification de source de données
  stockées ; la modification de `SECRET_KEY_BASE` invalide toutes les sessions. Ne
  les touchez que pendant une fenêtre de maintenance planifiée.
- **La première exécution est un assistant de configuration.** Avec
  `DISABLE_SIGNUPS = "true"`, ouvrez l'URL du service et complétez l'assistant : il crée le
  premier utilisateur administrateur et l'espace de travail, puis vous amène
  dans le constructeur d'applications. Il n'y a pas d'identifiant
  administrateur pré-rempli dans Secret Manager.
- **La fonctionnalité de base de données ToolJet.** Les applications peuvent
  interroger une base de données sans code intégrée (`<service_name>_tjdb`) exposée via
  un conteneur sidecar **PostgREST** (`postgrest/postgrest`) dans la même instance Cloud
  Run. Il reconfigure un schéma `postgrest` à chaque démarrage en tant
  qu'utilisateur de l'application — c'est pourquoi `db-init` réinitialise ce
  schéma pour qu'il appartienne à l'application.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/` — un point de terminaison public et non authentifié.
  Prévoyez plusieurs minutes au premier démarrage pour l'étape de migration.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
ToolJet sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tooljet` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `ToolJet` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image `tooljet/tooljet-ce` ; épingler à une version spécifique en production. |
| `db_name` | `tooljet` | Nom de la base de données de métadonnées. Immuable après le premier déploiement. |
| `db_user` | `tooljet` | Utilisateur de la base de données d'application (partagé par les deux bases de données). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | ToolJet est livré comme une version personnalisée légère sur `tooljet/tooljet-ce`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `container_resources` | `null` | Objet `{ cpu_limit, memory_limit, cpu_request, mem_request }` structuré ; lorsqu'il est défini, il remplace `cpu_limit`/`memory_limit`. |
| `min_instance_count` | `1` | Maintient le worker intégré à chaud ; ne définissez pas `0` sauf si le worker est externalisé. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `cpu_always_allocated` | `true` | Requis — le worker d'arrière-plan de ToolJet s'exécute sans requête entrante. |
| `container_port` | `80` | ToolJet sert l'API + le client sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image ToolJet dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour l'interface utilisateur du constructeur et les points de terminaison de l'application. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ou `PG_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager pendant le déploiement, pour les valeurs connues au moment de la planification. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; ToolJet lui-même est sans état et ne l'utilise pas. |
| `enable_nfs` | `true` | Activé par défaut ; sa VM co-héberge Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (les deux bases de données + rôle `CREATEROLE`). |
| `cron_jobs` | `[]` | Cloud Scheduler planifié + Cloud Run Jobs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60 s, 30 × 15 s | Sonde de démarrage. Large budget pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, période de 30 s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | _(défini)_ | Sondes structurées alternatives. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Stratégies d'alerte métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Prend en charge les files d'attente BullMQ de ToolJet. Transmis sans modification. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`), ou définir un point de terminaison Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

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
| `database_name` / `database_user` | Nom / utilisateur de la base de données de métadonnées. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour ToolJet). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — une
> réplique en lecture sans son primaire, IAP sans identités autorisées, un
> runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors
> plage. Une configuration invalide échoue à la **planification** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Sa rotation corrompt définitivement toutes les informations d'identification de source de données stockées — elles ne peuvent pas être déchiffrées et doivent toutes être ressaisies. |
| `SECRET_KEY_BASE` (auto-généré) | Ne faire pivoter que pendant une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions actives, forçant une reconnexion immédiate pour tout le monde. |
| `PGRST_JWT_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Sa rotation interrompt la couche de requête de la base de données ToolJet jusqu'à ce que chaque instance redémarre et que PostgREST soit reconfiguré. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide échoue au job d'importation. |
| Rôle d'application `CREATEROLE` (défini par `db-init`) | Laisser tel quel | Élevé | Sans cela, la création de l'espace de travail ToolJet échoue `permission denied to create role`. |
| Migrations de schéma (point d'entrée) | Laisser tel quel | Élevé | Ignorer `db:migrate:prod` laisse la base de données de métadonnées vide — l'application démarre et répond à la sonde de santé `/`, mais chaque action basée sur la base de données échoue. |
| `min_instance_count` | `1` | Élevé | Définir `0` permet au worker d'arrière-plan intégré d'être limité à zéro entre les requêtes, bloquant les jobs en file d'attente. |
| `cpu_always_allocated` | `true` | Élevé | La facturation basée sur les requêtes limite le worker d'arrière-plan entre les requêtes. |
| `memory_limit` | `4Gi` | Élevé | Le serveur ToolJet et son worker peuvent manquer de mémoire en dessous de ~2 GiB sous charge. |
| `ingress_settings` | `all` | Élevé | `internal` bloque l'interface utilisateur du constructeur et toutes les rappels d'applications externes. |
| `enable_redis` | `true` | Moyen | Avec Redis désactivé, BullMQ se replie et les fonctionnalités d'arrière-plan se dégradent. |
| `redis_host` | `""` (NFS) ou explicite | Moyen | Redis activé mais NFS désactivé et aucun hôte défini laisse `REDIS_HOST` vide. |
| `DISABLE_SIGNUPS` (auto-injecté `"true"`) | Garder activé après le premier administrateur | Élevé | L'ouverture de l'inscription permet à quiconque ayant l'URL de créer un compte. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur du constructeur est accessible publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à ToolJet partagée avec la variante GKE est décrite
dans **[ToolJet_Common](ToolJet_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : ToolJet sur Cloud Run](../labs/ToolJet_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ToolJet sur GKE Autopilot](ToolJet_GKE.md) — la même application sur Kubernetes, pour les cas où vous avez besoin de l'autre cible de déploiement.
- [ToolJet Common — Configuration d'application partagée](ToolJet_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md), [Hasura sur Google Cloud Run](Hasura_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **Outils internes low-code**.
