---
title: "LangFlow sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LangFlow sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LangFlow_CloudRun.md @ e69407af sha256:8251be4ee4b5 -->

# LangFlow sur Google Cloud Run {#langflow-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LangFlow_CloudRun.png" alt="LangFlow sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LangFlow est un constructeur visuel open-source et low-code pour les agents et
les workflows d'IA, basé sur LangChain. Il permet d'assembler des chaînes de
modèles linguistiques, des pipelines RAG et des agents en faisant glisser et en
connectant des composants sur une toile, puis de les exposer sous forme d'API.
Ce module déploie LangFlow sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par LangFlow et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte LangFlow sur RAD, et comment cela se compare {#what-langflow-costs-on-rad-and-how-that-compares}

**LangFlow sur le module Cloud Run de RAD coûte environ 84 US$ par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 US$).** LangFlow lui-même est gratuit et open source, il s'agit donc du coût d'infrastructure de votre propre canevas, en plus de ce que les fournisseurs de LLM que vous y connectez facturent séparément. Si vous n'en avez besoin qu'occasionnellement — pour prototyper un flux, un atelier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 84 US$ deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 US$ au prix de la recharge, 77 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte
qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| **Total** | **environ 84 US$** |

### Comment cela se compare {#how-it-compares}

- **DataStax, qui maintient LangFlow, propose un compte cloud hébergé gratuit**, mais ne publie pas de prix mensuel fixe pour celui-ci — il est basé sur l'utilisation/les crédits plutôt que sur un abonnement forfaitaire, nous ne citons donc pas de chiffre ici.
- **Dimensionné pour les 1 vCPU/2 GiB de LangFlow plus son serveur de fichiers partagé, un Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go Droplet (environ 24 US$/mois)** pourrait faire fonctionner LangFlow et Postgres ensemble pour moins cher en termes monétaires — mais vous devrez alors gérer Postgres, les sauvegardes, les correctifs de sécurité et le stockage de fichiers vous-même.
- Dans les deux cas, les appels aux fournisseurs de LLM effectués par LangFlow sont facturés séparément par le modèle que vous connectez, que ce soit sur RAD ou sur une machine autogérée.
- Voir le [guide GKE](LangFlow_GKE.md) pour un déploiement qui reste disponible en continu.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LangFlow s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
l'ensemble du projet, et le restaurer dans les 30 jours pour presque rien.**
Ceci convient bien mieux à LangFlow dont vous n'avez besoin qu'occasionnellement
— un projet de cours, une démo, une évaluation de courte durée — que de le
faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas
  le projet immédiatement : il le conserve, récupérable, pendant 30 jours. La
  facturation étant déjà déliée, rien n'est facturé pendant cette période. Contrairement
  à la suppression d'un module, cela ne démantèle pas Cloud SQL, aucune VM ou le
  calcul propre à LangFlow un par un — l'ensemble du projet, et tout ce qu'il
  contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  réactiver le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes — c'est une vérification, pas une reconstruction, et une
  mise à jour ne facture jamais les frais de module à nouveau. Pour LangFlow derrière
  un petit Services_GCP et Project_GCP, cela représente **une poignée de crédits
  (moins de 1 US$)** au total, contre les 80 crédits que coûte un redéploiement
  complet.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet
  que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement. La
  restauration est admise comme la création d'un nouveau projet : votre solde de
  crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
  niveau sandbox qui convient à la plupart des utilisations d'étude et de démo).
  Google indique que la plupart des services sont à nouveau pleinement
  opérationnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  nocturnes de LangFlow sont écrites dans un bucket à l'intérieur du projet, et ce
  bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est
  donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le
  projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé
  LangFlow et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers
  Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  workflow de redéploiement ci-dessous. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run s'adapte déjà à zéro entre les requêtes. L'option ci-dessus ne
s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois
la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 80 crédits (8,00 US$), car RAD recrée le projet et les services partagés
  avant LangFlow. La suppression ne permet d'économiser de l'argent que si LangFlow
  devait rester inutilisé pendant environ trois jours ou plus, à la fois dans votre
  propre projet (environ 2,79 US$ par jour) et dans un projet géré par RAD (32
  crédits par jour).
- **Supprimez tout ce que LangFlow utilise.** La majeure partie du coût
  d'exécution est généralement la base de données et la VM de fichier/cache
  partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les
  utilise, donc la suppression de LangFlow alors que quelque chose d'autre partage
  le projet n'économise que la partie calcul propre à LangFlow.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket
  à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière
  sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session LangFlow
  pour une classe. Chaque participant dispose de LangFlow dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places à l'avance,
  soit chaque participant paie la sienne. Tout est supprimé à la fin de la session,
  et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  LangFlow pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin de l'engagement, le partenaire transfère le projet,
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et estimation quotidienne de 32 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source
avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LangFlow s'exécute comme un conteneur Python unique (FastAPI + React) sur Cloud
Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python sur le port **7860**, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — LangFlow persiste tous les flux, composants et identifiants dans Postgres |
| Stockage d'objets | Cloud Storage | Un bucket `data` est provisionné par défaut (`storage_buckets`) mais laissé non monté (`gcs_volumes = []`) — LangFlow conserve tout l'état de l'application dans PostgreSQL |
| Cache et file d'attente | Redis (facultatif) | Non requis par LangFlow ; câblé pour la compatibilité ascendante uniquement |
| Secrets | Secret Manager | Auto-généré `LANGFLOW_SECRET_KEY` et `LANGFLOW_SUPERUSER_PASSWORD` ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`database_type = "POSTGRES_15"`) ; la sélection de tout autre moteur
  interrompt le démarrage.
- **`LANGFLOW_SECRET_KEY` est généré automatiquement** et stocké dans Secret Manager. Il
  chiffre toutes les informations d'identification stockées intégrées dans un flux. Il
  ne doit jamais être renouvelé après le premier démarrage — le renouveler rompt
  définitivement toutes les informations d'identification stockées, qui doivent alors
  être ressaisies dans chaque flux.
- **Le compte administrateur est provisionné à partir d'un mot de passe généré.**
  `LANGFLOW_AUTO_LOGIN = "false"` active l'authentification ; LangFlow crée l'administrateur initial
  (`admin` par défaut) en utilisant le secret `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez-le
  depuis Secret Manager pour vous connecter.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les
  démarrages à froid ajoutent plusieurs secondes de latence — plus les migrations
  Alembic au premier démarrage sur une nouvelle instance. Définissez `min_instance_count = 1`
  pour maintenir le canevas chaud pour l'édition interactive.
- **`max_instance_count = 1` par défaut.** LangFlow conserve l'état de session et de flux
  en cours de traitement ; exécutez une seule instance à moins que vous n'ayez
  externalisé l'état et que vous compreniez les implications.
- **Ingress public par défaut.** `ingress_settings = "all"` expose l'URL `run.app`.
  L'activation d'IAP place la connexion Google devant l'ensemble du service, y
  compris son API.
- **NFS contient les téléchargements, et le bucket GCS par défaut est non monté.** Les
  flux, les utilisateurs et les informations d'identification vivent dans PostgreSQL ;
  NFS est activé par défaut (`enable_nfs = true`, monté à `/data` comme
  répertoire de configuration de LangFlow, où les fichiers téléchargés sont conservés)
  et doit rester activé, tandis que le bucket `data` auto-provisionné n'est
  pas monté dans le conteneur (`gcs_volumes = []`) — il existe pour que vous le
  connectiez uniquement si un composant personnalisé a besoin de stockage d'objets.
- **`LANGFLOW_DATABASE_URL` est composé à l'exécution** par le point d'entrée du conteneur à
  partir des variables `DB_*` injectées (DSN TCP, `sslmode=require` sur Cloud Run)
  — vous ne le définissez pas vous-même.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service LangFlow {#a-cloud-run--the-langflow-service}

LangFlow s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge de requêtes entre le nombre minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sécurisés.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~langflow"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LangFlow stocke toutes les données d'application (flux, composants,
informations d'identification, historique d'exécution, utilisateurs) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte
privément via l'**adresse IP privée** de l'instance (le point d'entrée compose
un DSN TCP avec `sslmode=require`) ; le socket Unix du proxy d'authentification Cloud
SQL est également monté. Lors du premier déploiement, un job
d'initialisation crée la base de données de l'application, le rôle et les
autorisations.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~langflow"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Redis (facultatif — non utilisé par LangFlow) {#c-redis-optional--not-used-by-langflow}

Redis est **désactivé par défaut** et LangFlow ne le requiert pas ; les entrées
`enable_redis` sont câblées uniquement pour la compatibilité ascendante. Laissez
`enable_redis = false` à moins qu'une fonctionnalité future ne le nécessite.

- **CLI (uniquement si activé) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`LANGFLOW_SECRET_KEY` (chiffre toutes les informations d'identification stockées) et
`LANGFLOW_SUPERUSER_PASSWORD` (le mot de passe de connexion administrateur initial). Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~langflow"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LangFlow {#3-langflow-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) exécute le script générique `db-init.sh` de la
  fondation en utilisant `postgres:15-alpine`. Il attend PostgreSQL, puis crée de manière
  idempotente le rôle et la base de données de l'application, définit la
  propriété et accorde les privilèges sur la base de données. Il peut être
  réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** LangFlow exécute ses **migrations
  Alembic à chaque démarrage de conteneur**, de sorte que les tables sont créées et
  mises à jour par l'application elle-même — le job `db-init` ne gère que le
  rôle/la base de données/les autorisations. Prévoyez un temps supplémentaire au
  premier démarrage.
- **`LANGFLOW_SECRET_KEY` est immuable après le premier démarrage.** Il est généré une
  fois et écrit dans Secret Manager. Le modifier rompt définitivement toutes les
  informations d'identification stockées intégrées dans un flux ; elles ne peuvent
  plus être déchiffrées. Ne le renouvelez que pendant une fenêtre de maintenance
  planifiée avec un plan de ressaisie des informations d'identification.
- **Compte administrateur initial.** Avec `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow crée le
  super-utilisateur (`admin` par défaut, défini via `langflow_username`) en
  utilisant le secret `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez le mot de passe et connectez-vous :
  ```bash
  gcloud secrets versions access latest \
    --secret=<langflow-password-secret> --project "$PROJECT"
  ```
- **L'URL de la base de données est composée à l'exécution.** Le point d'entrée
  construit `LANGFLOW_DATABASE_URL` à partir des variables `DB_*` injectées via TCP
  (`DB_IP`, `sslmode=require` sur Cloud Run) — ne le définissez pas
  manuellement à moins que vous n'ayez l'intention de remplacer l'ensemble du DSN.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  **`/health`**, le point de terminaison de vivacité public de LangFlow qui
  renvoie `200` une fois le serveur démarré. La sonde de démarrage par
  défaut autorise un délai initial de 60 secondes plus une fenêtre d'échec de 60 ×
  10 s (600 s) pour couvrir le chargement des composants au premier démarrage et les
  migrations Alembic.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
LangFlow sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langflow` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `LangFlow` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de version de l'image LangFlow ; épingle l'image de base `1.10.2` lorsque `latest`. Épinglez explicitement en production. |
| `langflow_username` | `admin` | Nom d'utilisateur du super-utilisateur (administrateur) initial ; le mot de passe est auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | LangFlow est construit à partir de l'image enveloppée via Cloud Build. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; conservez ≥ 1 GiB pour l'exécution Python. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour maintenir le canevas chaud. |
| `max_instance_count` | `1` | Conservez à `1` — LangFlow conserve l'état en cours de traitement. |
| `container_port` | `7860` | LangFlow écoute sur le port 7860. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Montage du socket du proxy d'authentification Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image du conteneur dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` expose l'URL publique `run.app`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'ensemble du service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés sur les valeurs par défaut de LangFlow. Ne définissez pas `LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD` ou `LANGFLOW_DATABASE_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager (par exemple, clés API du fournisseur LLM). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et initialisation {#group-9--custom-sql-scripts--initialization}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste pour les composants personnalisés. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : le montage est le répertoire de configuration de LangFlow, où résident les fichiers téléchargés. Les flux, les utilisateurs et les informations d'identification sont dans Cloud SQL de toute façon. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur (lorsque NFS est activé). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — LangFlow nécessite PostgreSQL 15. |
| `application_database_name` | `langflowdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `langflowuser` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé | Extensions Postgres facultatives. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", image = "postgres:15-alpine", script_path = "scripts/db-init.sh", execute_on_apply = true }]` | Job intégré qui crée le rôle d'application, la base de données et les autorisations lors du premier déploiement. Remplacez par une liste non vide pour exécuter différents jobs. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés (aucun requis par LangFlow). |
| `additional_services` | `[]` | Services sidecar/d'aide déployés avec LangFlow. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 60 s, fenêtre d'échec de 60 × 10 s | Sonde de démarrage. La généreuse fenêtre de 600 s après le délai de 60 s tient compte du premier démarrage de LangFlow (chargement de tous les composants + amorçage des projets de démarrage avant la liaison uvicorn — 2 à 4 minutes) ainsi que des migrations Alembic au premier démarrage. |
| `liveness_probe` | HTTP `/health`, délai de 30 s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/health`, activé | Sonde structurée au niveau d'App_CloudRun (parallèle à `startup_probe`, qui est transmise à LangFlow_Common). |
| `health_check_config` | HTTP `/health`, activé | Sonde de vivacité structurée au niveau d'App_CloudRun (parallèle à `liveness_probe`). |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring ; activez pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis (facultatif) {#group-21--redis-cache-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par LangFlow ; câblé uniquement pour la compatibilité ascendante. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Paramètres de connexion Redis (uniquement si activé). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage, et plus encore. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LANGFLOW_SECRET_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler rompt définitivement toutes les informations d'identification stockées intégrées dans un flux — elles ne peuvent pas être déchiffrées et doivent être ressaisies. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les flux et informations d'identification. |
| `database_type` | `POSTGRES_15` | Critique | LangFlow nécessite PostgreSQL 15 ; tout autre moteur interrompt le démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide fait échouer le job d'importation. |
| `LANGFLOW_SUPERUSER_PASSWORD` (auto-généré) | Récupérer depuis Secret Manager | Élevé | C'est la connexion administrateur ; la perdre signifie qu'il n'y a aucun moyen de se connecter tant qu'elle n'est pas réinitialisée. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1 GiB risquent des arrêts OOM pour l'exécution Python sous charge. |
| `max_instance_count` | `1` | Élevé | LangFlow conserve l'état de session/flux en cours de traitement ; la mise à l'échelle au-delà de 1 divise l'état entre les instances et provoque un comportement incohérent. |
| `enable_iap` | uniquement lorsque l'authentification API n'est pas nécessaire en externe | Élevé | IAP place la connexion Google devant l'ensemble du service, y compris son API programmatique. |
| `container_port` | `7860` | Élevé | LangFlow écoute sur le port 7860 ; un port non concordant fait échouer toutes les sondes de santé. |
| `min_instance_count` | `1` pour une utilisation interactive | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid plus le temps de migration au premier démarrage sur une nouvelle instance. |
| `enable_cloudsql_volume` | `true` | Moyen | La désactivation supprime le montage du socket ; le point d'entrée s'appuie alors uniquement sur le chemin TCP IP privée. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur et l'API sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
construction d'images — voir **[App_CloudRun](App_CloudRun.md)**. La
configuration d'application spécifique à LangFlow partagée avec la variante GKE
est décrite dans **[LangFlow_Common](LangFlow_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : LangFlow sur Cloud Run](../labs/LangFlow_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LangFlow sur GKE Autopilot](LangFlow_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [LangFlow Common — Configuration d'application partagée](LangFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
