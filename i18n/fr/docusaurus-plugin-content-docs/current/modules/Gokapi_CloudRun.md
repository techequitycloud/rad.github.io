---
title: "Gokapi sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Gokapi sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gokapi_CloudRun.md @ e69407af sha256:38fda3fbec56 -->

# Gokapi sur Google Cloud Run {#gokapi-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gokapi_CloudRun.png" alt="Gokapi sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gokapi est un serveur de partage de fichiers léger et auto-hébergé écrit en Go
— une alternative auto-hébergée à WeTransfer. Les utilisateurs téléchargent des
fichiers et génèrent des liens de téléchargement partageables avec des dates
d'expiration, des limites de nombre de téléchargements et une protection par mot
de passe facultatives, le tout soutenu par une base de données SQLite interne
(aucune base de données externe requise). Ce module déploie Gokapi sur **Cloud
Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Gokapi utilise et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Gokapi sur RAD, et comment cela se compare {#what-gokapi-costs-on-rad-and-how-that-compares}

**L'exécution de Gokapi dans votre propre projet Google Cloud coûte environ
32,57 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD de 40
crédits (une seule fois)** (36 crédits — 10 % de moins — dans un projet géré
par RAD). Gokapi est un serveur de partage de fichiers léger et auto-hébergé
écrit en Go. Si vous le déployez dans un projet géré par RAD, vous pouvez
mettre en pause l'ensemble gratuitement et le reprendre plus tard — voir
« Mettre en pause gratuitement » ci-dessous.

*Gokapi est également disponible sur GKE — consultez le [guide GKE](Gokapi_GKE.md)
si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre
l'option Cloud Run, moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **40 crédits** (une seule fois) | **36 crédits** (une seule fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une seule fois, par build) | ~3–6 crédits (une seule fois, par build) |
| Coût d'exécution Google Cloud | ~32,57 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~15 crédits/jour (~1,50 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (chaud) | 13,14 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **32,57 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'y a pas de version officielle hébergée/cloud de Gokapi à comparer, donc
  la comparaison honnête se fait avec une infrastructure autogérée, et non
  avec un SaaS concurrent.
- Un VPS nu dimensionné à environ 1 vCPU / 1 Gio — un Hetzner CPX22 (2 vCPU/4
  Go, ~24 $ US/mois), un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois), ou
  le propre Compute Engine e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois)
  — est généralement moins cher que le prix affiché de RAD ; un VPS d'une ou
  deux tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le
  système d'exploitation, faire tourner les sauvegardes de base de données,
  renouveler les certificats TLS et surveiller les temps d'arrêt. Cloud SQL,
  Secret Manager et la surveillance gérés par RAD le font pour vous, ce qui
  est le véritable compromis, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes monétaires — ce
  n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour
  vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Gokapi est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de
payer entièrement sans le détruire. La suppression de ce projet délie d'abord
sa facturation, puis demande à Google de supprimer le projet purement et
simplement — la suppression logique récupérable de 30 jours de Google. Contrairement
à la suppression du module Gokapi seul, cela ne démolit pas Cloud SQL, aucune
VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter Update sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement,
cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
vérification, pas une reconstruction, et une mise à jour ne facture plus jamais
les frais de module. Cela ne coûte qu'une poignée de crédits de temps de build
au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne de
déploiement typique de 2 à 3. Les frais de module de 36 crédits ne sont pas
facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google
indique que la plupart des services fonctionnent à nouveau pleinement dans les
36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et la suppression logique de Cloud Storage est
explicitement désactivée pour ce bucket, il est donc très probable qu'il
disparaisse dès que vous supprimez le projet — même si le projet lui-même est
récupérable pendant 30 jours. Si vous avez personnalisé Gokapi et que vous
souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un
bucket en dehors du projet) avant de la supprimer. Pour une installation par
défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Gokapi se trouve dans votre propre projet (ou si plus de 30 jours se sont
écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez
à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds :
environ **40 + ~3–6 crédits** (~4,45 $ US) dans votre propre projet, ou **36 +
~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Gokapi reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son
propre coût d'exécution : environ **5 jours ou plus** d'inactivité dans votre
propre projet (par rapport à sa facture Google Cloud d'environ 32,57 $ US/mois),
ou **environ 3 jours ou plus** d'inactivité dans un projet géré par RAD (par
rapport à ses ~15 crédits/jour).

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  autorisation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est interrompue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la
  propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF,
  XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ; [documentation de Google sur la
suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Gokapi s'exécute comme un conteneur binaire Go unique sur Cloud Run v2, sans
base de données externe. Le déploiement relie un petit ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur binaire Go sur le port `53842`, `1000m` CPU / `1Gi` mémoire par défaut ; révision unique, `min_instance_count = 1` / `max_instance_count = 1` |
| Base de données | **Aucune (SQLite, sur stockage monté)** | Pas de Cloud SQL — `database_type` est fixé à `NONE` par `Gokapi_Common` ; Gokapi écrit sa propre base de données SQLite sous `GOKAPI_CONFIG_DIR` |
| Persistance des fichiers et de la base de données | Bucket Cloud Storage monté via **GCS Fuse** à `/data` | Le seul chemin de persistance disponible sur Cloud Run — il n'y a pas de concept de PVC/stockage par blocs ici, contrairement au PVC StatefulSet utilisé par `Gokapi_GKE` |
| Stockage d'objets | Cloud Storage | Le bucket suffixé `storage` est auto-provisionné et, sur Cloud Run, est toujours monté (pas inactif, contrairement à la variante GKE) |
| Secrets | Secret Manager | Seulement une clé API d'opérateur **facultative** (`GOKAPI_API_KEY`) ; pas de secret généré obligatoire |
| Ingress | URL Cloud Run / Cloud Load Balancing | `ingress_settings = "all"` par défaut, donc le service est publiquement accessible dès la sortie de la boîte |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL, jamais.** `database_type` est fixé en dur à `NONE` par
  `Gokapi_Common` — les variables de base de données génériques de ce module
  (`sql_instance_name`, `application_database_name`, `db_*_env_var_name`, etc.)
  sont transmises à la fondation uniquement pour la compatibilité de la
  mise en miroir des variables et n'ont aucun effet.
- **SQLite + fichiers téléchargés persistent via un montage GCS Fuse, pas un
  véritable volume de blocs.** Cloud Run n'a pas d'équivalent PVC/StatefulSet,
  donc `Gokapi_Common` monte le bucket `storage` auto-provisionné à `/data`
  à l'aide de GCS Fuse (`enable_gcs_storage_volume` par défaut `true` à l'intérieur de
  `Gokapi_Common`, et cette variante Cloud Run n'expose **aucune variable pour le
  désactiver** — ce commutateur n'existe que sur `Gokapi_GKE`, lié à `stateful_pvc_enabled`).
  `GOKAPI_CONFIG_DIR =
  /data/config` (config + la base de données SQLite) et `GOKAPI_DATA_DIR = /data/data` (fichiers
  téléchargés) résident tous deux sur ce montage. GCS Fuse ne fournit pas de
  verrouillage de fichiers POSIX réel, ce qui est exactement la sémantique dont
  dépend une application basée sur SQLite — voir [Section 6](#6-configuration-pitfalls--sensible-defaults)
  pour le risque que cela comporte.
- **Le bucket GCS `storage` est essentiel ici, pas décoratif.** Contrairement à
  `Gokapi_GKE` (où le bucket reste inutilisé derrière un PVC StatefulSet par
  défaut), sur Cloud Run, ce bucket **est** la couche de persistance pour la
  base de données SQLite et tous les fichiers téléchargés.
- **Instance unique par conception.** `min_instance_count = 1`, `max_instance_count =
  1`. La base de données SQLite de Gokapi est à écrivain unique sans
  clustering/réplication, donc ne pas dépasser 1 instance.
- **Aucun mot de passe administrateur n'est généré automatiquement.** Gokapi
  n'a pas de secret obligatoire — le compte administrateur est créé
  interactivement via l'assistant de configuration de première exécution de
  Gokapi à **`/setup`** (la sortie `setup_url`). Tant qu'il n'est pas
  terminé, toutes les autres pages — `/` inclus — répondent
  « Le serveur est en mode maintenance, veuillez réessayer dans quelques
  minutes ».
- **Clé API d'opérateur facultative, requise par défaut.** `enable_api_key` (par
  défaut `true` sur `Gokapi_CloudRun`) génère un jeton aléatoire de 32
  caractères, le stocke dans Secret Manager et l'injecte en tant que
  `GOKAPI_API_KEY` via le mécanisme `module_secret_env_vars` du module. Il s'agit d'un jeton
  de commodité uniquement — les propres clés API de téléchargement/téléchargement
  de Gokapi sont normalement générées à partir de l'interface
  utilisateur d'administration après la configuration. Il est par défaut
  `true` ici (contrairement au propre défaut `Gokapi_Common` de `false`)
  en raison de la protection au moment de la planification ci-dessous.
- **Redis est désactivé de force.** `main.tf` code en dur `enable_redis = false` à la
  fondation quelle que soit la valeur de la variable — Gokapi n'a aucune
  utilité pour Redis.
- **L'ingress public est activé par défaut, et il est protégé au moment de la
  planification par la clé API.** `ingress_settings = "all"` correspond à l'objectif de
  Gokapi de générer des liens de téléchargement partageables accessibles depuis
  l'extérieur du VPC — mais cela signifie également que l'assistant de
  configuration de première exécution non authentifié est publiquement
  accessible jusqu'à ce qu'un compte administrateur soit revendiqué. La
  protection `validation.tf` de `validate_gokapi_configuration` échoue en cas de planification
  chaque fois que `ingress_settings = "all"` est combiné avec `enable_api_key = false`, de sorte que
  la paire par défaut du module (`"all"` + `enable_api_key = true`) est la seule
  combinaison prête à l'emploi qui se planifie proprement ; le passage de
  `enable_api_key` à `false` nécessite également de restreindre
  `ingress_settings` à `"internal"` (ou `"internal-and-cloud-load-balancing"`).
- **Construit comme une image personnalisée mince, épinglée contre le piège de
  la balise `latest`.** L'image est un wrapper `FROM f0rc3/gokapi:${GOKAPI_VERSION}` d'une ligne
  afin que la fondation puisse la mettre en miroir dans Artifact Registry.
  `GOKAPI_VERSION` (un argument de build spécifique à l'application que l'injection
  générique `APP_VERSION` de la fondation ne touche pas) se résout en un
  `v1.9.6` épinglé lorsque `application_version = "latest"`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont signalés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Gokapi {#a-cloud-run--the-gokapi-service}

Gokapi s'exécute comme un service/révision Cloud Run v2 unique. `min_instance_count = 1`
maintient une instance chaude en permanence (évitant les démarrages à froid et
préservant l'écrivain SQLite unique) ; `max_instance_count = 1` ne doit pas être augmenté.

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

### B. Stockage persistant — le montage GCS Fuse à `/data` {#b-persistent-storage--the-gcs-fuse-mount-at-data}

Il n'y a pas d'instance Cloud SQL ni de PVC. Au lieu de cela, le bucket Cloud
Storage `storage` auto-provisionné est monté dans le conteneur en tant que
volume GCS Fuse à `/data`, et `GOKAPI_CONFIG_DIR=/data/config` (base de données de métadonnées
SQLite + configuration de l'application) et `GOKAPI_DATA_DIR=/data/data` (fichiers
téléchargés) résident tous deux sous ce montage unique. Ce montage est
inconditionnel sur ce module — il n'y a pas de variable ici pour le désactiver
(comparez `Gokapi_GKE`, qui désactive le volume GCS équivalent chaque fois que
son PVC StatefulSet est activé).

- **Console :** Cloud Storage → Buckets, pour le contenu du bucket ; Cloud Run
  → service → Révisions → **Volumes**, pour confirmer le montage.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la sémantique du montage GCS Fuse et
sa mise en garde de performance déclarée pour les charges de travail de type
base de données, et [Section 6](#6-configuration-pitfalls--sensible-defaults)
ci-dessous pour savoir pourquoi cela est important spécifiquement pour la base
de données SQLite de Gokapi.

### C. Secret Manager — la clé API facultative {#c-secret-manager--the-optional-api-key}

Gokapi ne crée **aucun secret obligatoire**. Le seul secret que ce module peut
créer est le jeton de commodité d'opérateur `GOKAPI_API_KEY` facultatif, protégé par
`enable_api_key` (par défaut `false`). Ce secret n'est **pas** affiché dans
les [Sorties](#5-outputs) de ce module — recherchez-le directement par son nom.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la
rotation des secrets.

### D. Réseau — Ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings =
"all"`),
correspondant à l'objectif de Gokapi de générer des liens de téléchargement
partageables en externe. Un équilibreur de charge HTTPS externe avec Cloud
Armor, un domaine personnalisé et Cloud CDN peuvent être superposés via les
variables du groupe 10.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging — Surveillance {#e-cloud-logging--monitoring}

Les journaux de conteneur sont acheminés vers Cloud Logging ; les métriques
Cloud Run sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs (tous deux désactivés par
défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gokapi {#3-gokapi-application-behaviour}

- **Aucun job d'initialisation ne s'exécute par défaut.** `Gokapi_Common` ne fournit
  pas d'entrée `initialization_jobs` par défaut — Gokapi gère son propre stockage et n'a
  pas besoin de base de données pour démarrer. Seuls les jobs fournis par
  l'utilisateur (chargement de données personnalisé ou migration) apparaissent
  sous Cloud Run Jobs.
- **La configuration du premier démarrage est entièrement interactive.** Il n'y
  a pas de drapeau d'installation automatique ni de mot de passe
  administrateur généré. La première personne à ouvrir **`/setup`** sur
  l'URL publique du service (la sortie `setup_url`) crée le compte
  administrateur via l'assistant de Gokapi — la première personne à y arriver.
  `/` lui-même n'affiche que « Le serveur est en mode maintenance »
  jusque-là.
- **Où les données persistent physiquement.** `GOKAPI_CONFIG_DIR=/data/config` (la base de données
  de métadonnées SQLite et la configuration de l'application) et `GOKAPI_DATA_DIR=/data/data`
  (fichiers téléchargés) résident tous deux sur le montage GCS Fuse du bucket
  `storage` à `/data`. Il n'y a pas de commutateur intégré pour déplacer
  cela vers NFS ou un backend différent ; cela nécessiterait de remplacer
  manuellement `environment_variables` et d'activer `enable_nfs`.
- **Écrivain unique, instance unique.** `min_instance_count = 1` / `max_instance_count = 1` par
  défaut. La base de données SQLite de Gokapi n'a pas de clustering/réplication,
  donc n'augmentez pas `max_instance_count` au-dessus de 1.
- **Les sondes de santé atteignent la racine publique, aucune authentification
  requise.** Les sondes de démarrage et de vivacité sont toutes deux **HTTP GET
  `/`** (racine publique de Gokapi, 200, non authentifiée — avant la
  configuration, c'est l'avis de maintenance, toujours 200) — démarrage :
  `initial_delay=15s, timeout=5s, period=10s,
  failure_threshold=10` ; vivacité : `initial_delay=30s, timeout=5s, period=30s,
  failure_threshold=3`.
- **Le port du conteneur est fonctionnellement fixé à `53842`, même si la
  variable est transmise.** Contrairement à `Gokapi_GKE` (où la variable
  équivalente `container_port` est déclarée mais jamais transmise), le `gokapi.tf`
  de cette variante Cloud Run fusionne `container_port = var.container_port` dans la configuration par
  application qui atteint la fondation — la valeur est donc techniquement
  active ici. Cependant, le propre port d'écoute de Gokapi est codé en dur
  comme `GOKAPI_PORT = "53842"` dans `Gokapi_Common` de `environment_variables`, donc changer
  `container_port` de `53842` acheminerait le trafic Cloud Run vers un port
  sur lequel le conteneur n'écoute pas réellement. Laissez-le par défaut.
- **Inspecter le service déployé et son état persistant :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Gokapi sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gokapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Gokapi File Sharing` | Nom lisible par l'homme affiché dans la Console. |
| `description` | `Gokapi self-hosted file sharing` | Description du service. |
| `application_version` | `latest` | Balise d'image Gokapi ; se résout en un `v1.9.6` épinglé lorsque `latest` via l'argument de build `GOKAPI_VERSION` spécifique à l'application. |
| `enable_api_key` | `true` | Génère une clé API d'opérateur aléatoire dans Secret Manager, injectée en tant que `GOKAPI_API_KEY`. Un jeton de commodité uniquement — Gokapi génère ses propres clés API réelles à partir de l'interface utilisateur d'administration. Par défaut `true` car la protection au moment de la planification dans `validation.tf` rejette le défaut `ingress_settings = "all"` du module lorsque cela est `false`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Gokapi est un binaire Go léger et a peu de besoins. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid et conserver un seul écrivain SQLite chaud. |
| `max_instance_count` | `1` | **Maintenir à 1** — la base de données SQLite de Gokapi est à écrivain unique sans mode distribué. |
| `container_port` | `53842` | Transmis à la configuration par application du module (contrairement à `Gokapi_GKE`, où il est inerte) — mais doit correspondre à `GOKAPI_PORT`, qui est codé en dur `53842` dans `Gokapi_Common`. Ne pas modifier. |
| `execution_environment` | `gen2` | Gen2 requis pour le montage GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Doit rester `false` — Gokapi n'a pas de base de données Cloud SQL ; `main.tf` code cela en dur quelle que soit la valeur de la variable. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Gokapi dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1 standard ; Gokapi n'a pas d'exigence gRPC/HTTP2. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut, correspondant à l'objectif de Gokapi de générer des liens de téléchargement partageables. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. Bloque les destinataires anonymes de suivre les liens de téléchargement partagés. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GOKAPI_CONFIG_DIR`, `GOKAPI_DATA_DIR` et `GOKAPI_PORT` sont définis automatiquement — ne les remplacez pas. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Les variables de job de sauvegarde/importation `App_CloudRun` standard (`backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`) sont déclarées et transmises, mais **inertes pour Gokapi** — le
mécanisme de sauvegarde et d'importation de la fondation ne fonctionne que
lorsque `database_type` n'est pas `NONE`, et celui de Gokapi est fixé à
`NONE`. Il n'y a pas de sauvegarde automatisée de la base de données
SQLite ou des fichiers téléchargés ; sauvegardez directement le bucket GCS
`storage` si nécessaire.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés (inertes) et découverte d'instances NFS {#group-9--custom-sql-scripts-inert--nfs-instance-discovery}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off / `""` | Inerte — Gokapi n'a pas de base de données SQL pour exécuter des scripts. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS GCE existante à utiliser au lieu de l'auto-découverte. Pertinent uniquement si vous re-pointez manuellement le stockage de Gokapi vers NFS (voir Groupe 11). |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM NFS GCE intégrée, si elle est créée. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Cloud Run pour le montage NFS. |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` qui soutient `/data`. Laisser ceci `false` casserait le seul chemin de persistance de Gokapi. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : la base de données SQLite de Gokapi atterrit sous `/data`, et GCS FUSE ne peut pas héberger une base de données SQLite. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur si NFS est activé — distinct de `/data`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires ; le montage `storage` du bucket `/data` est toujours ajouté en plus de cette liste. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (valeur par défaut de la variable) | **Inerte** — `main.tf` code en dur `enable_redis = false` à la fondation quelle que soit la valeur de cette variable. Gokapi n'a aucune utilité pour Redis. |
| `redis_host` / `redis_port` / `redis_auth` | — | Déclaré uniquement pour la mise en miroir de convention ; jamais transmis à la fondation. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Toutes les variables du Groupe 12 (`database_type`, `sql_instance_name`,
`application_database_name`, `application_database_user`, `db_*_env_var_name`, `enable_postgres_extensions`,
`enable_mysql_plugins`, etc.) sont déclarées uniquement pour la compatibilité de la
mise en miroir de convention. `database_type` est fixé à `NONE` à
l'intérieur de `Gokapi_Common`, et aucune des variables de base de données
fratries n'est transmise à la fondation par `main.tf` — Gokapi n'a pas de
base de données SQL.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut n'est injecté ; utilisez ceci uniquement pour les jobs de chargement de données ou de migration personnalisés. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents ; Gokapi n'a pas de tâche de maintenance planifiée intégrée. |
| `backup_file` | `backup.sql` | Inerte — voir Groupe 7 ; pas de base de données à restaurer. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 15s de délai, 10 tentatives | Sonde de démarrage — racine publique de Gokapi (son interface utilisateur, ou avant la première configuration, l'avis de maintenance), pas d'authentification. |
| `liveness_probe` | HTTP `/`, 30s de délai, 3 tentatives | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/` (forme alternative) | Sonde structurée alternative. |
| `health_check_config` | HTTP `/` (forme alternative) | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 15 — Réseau {#group-15--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` | Déclaré pour la mise en miroir de convention ; non transmis par `main.tf` — le réseau VPC est toujours auto-découvert. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

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
| `gokapi_url` | L'URL du service Cloud Run (nommée `gokapi_url`, pas la générique `service_url` utilisée par d'autres modules). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés — inclut le bucket `storage` monté à `/data`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms de tous les jobs de configuration fournis par l'utilisateur (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

Notez l'absence de toute sortie `database_*` (il n'y a pas de base de données) et
d'une sortie d'identifiant secret pour la clé API facultative — récupérez
celle-ci directement avec `gcloud secrets list --filter="name~api-key"` (voir [Section 2C](#c-secret-manager--the-optional-api-key)).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages GCS Fuse, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Montage GCS Fuse à `/data` (inconditionnel, pas de bascule sur ce module) | L'accepter pour une utilisation légère ; passer à `Gokapi_GKE` pour des charges de travail plus lourdes | Critique | GCS Fuse ne fournit pas de véritable verrouillage de fichiers POSIX, dont SQLite dépend pour un accès concurrent sûr. Il n'y a aucun moyen d'échanger ce module contre un véritable volume de blocs — la bascule n'existe que sur le PVC StatefulSet de `Gokapi_GKE`. |
| `ingress_settings` | `all` (par défaut) avec revendication d'administrateur rapide | Élevé | Étant donné que le compte administrateur est créé via un assistant de première exécution ouvert et non authentifié, une URL publique signifie que **n'importe qui** qui l'atteint en premier revendique le compte administrateur. Revendiquez-le immédiatement après le déploiement, ou définissez `enable_iap = true` jusqu'à ce que vous l'ayez fait. |
| `max_instance_count` | `1` | Critique | La base de données SQLite de Gokapi est à écrivain unique sans clustering ; l'exécution de plus d'une instance risque de corrompre la base de données et de provoquer des téléchargements incohérents. |
| `container_port` | `53842` (laisser par défaut) | Élevé | `GOKAPI_PORT` est codé en dur à `53842` dans les variables d'environnement de `Gokapi_Common` indépendamment de cette variable ; changer `container_port` achemine le trafic Cloud Run vers un port que le conteneur n'écoute pas. |
| `create_cloud_storage` | `true` | Critique | La définition de `false` supprime le seul bucket de persistance de Gokapi — la base de données SQLite et tous les téléchargements y résident. |
| `enable_api_key` (secret auto-généré) | Laisser la valeur par défaut `true` pendant `ingress_settings = "all"` | Élevé | Une protection au moment de la planification (`validation.tf`'s `validate_gokapi_configuration`) fait échouer le plan si `ingress_settings = "all"` (la valeur par défaut du module) est combiné avec `enable_api_key = false` — l'accès public sans protection par clé API est rejeté d'emblée. Vous rencontrerez ce problème immédiatement si vous basculez `enable_api_key` vers `false` sans également restreindre `ingress_settings` à `"internal"` ou `"internal-and-cloud-load-balancing"`. Le jeton lui-même n'est qu'un secret de commodité — les véritables clés API de téléchargement/téléchargement de Gokapi sont générées à partir de l'interface utilisateur d'administration, quel que soit ce paramètre — mais la *protection* n'est pas facultative. |
| `enable_nfs` | `false` à moins que vous ne redirigiez également `GOKAPI_CONFIG_DIR`/`GOKAPI_DATA_DIR` | Moyen | L'activation de NFS seule provisionne une VM Filestore/NFS inutilisée — les données de Gokapi résident toujours à `/data` sur GCS Fuse à moins que vous ne remplaciez manuellement les variables d'environnement pour utiliser le chemin de montage NFS à la place. |
| `enable_backup_import` / `backup_schedule` / etc. | Laisser les valeurs par défaut | Faible | Ces variables sont inertes pour Gokapi (`database_type = NONE`) ; aucune sauvegarde automatisée de la base de données SQLite ou des téléchargements n'existe. Sauvegardez directement le bucket `storage` si vous en avez besoin. |
| `min_instance_count` | `1` (par défaut) | Faible | Garder 1 instance chaude évite les démarrages à froid sur les liens de téléchargement partagés ; c'est peu coûteux pour un binaire Go léger. |
| `enable_cloud_armor` | activer pour la production | Moyen | Une application de partage de fichiers accessible publiquement avec des surfaces d'administration/téléchargement non authentifiées bénéficie de la protection WAF. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Gokapi
partagée avec la variante GKE (image, bucket de stockage, clé API facultative, sondes de santé)
réside dans le module `Gokapi_Common` (`modules/Gokapi_Common`), qui n'a
pas encore de documentation de plateforme autonome — voir ses `main.tf`/`variables.tf`/`README.md` pour
le câblage sous-jacent.

## Guides associés {#related-guides}

- [Lab pratique : Gokapi sur Cloud Run](../labs/Gokapi_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gokapi sur GKE Autopilot](Gokapi_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Gokapi Common — Configuration d'application partagée](Gokapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md), [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) dans la solution **Partage et transfert de fichiers**.
