---
title: "GoAlert sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de GoAlert sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GoAlert_CloudRun.md @ e69407af sha256:47f23e6f06da -->

# GoAlert sur Google Cloud Run {#goalert-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoAlert_CloudRun.png" alt="GoAlert sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoAlert est une plateforme open-source, sous licence Apache 2.0, de planification
d'astreintes et d'escalade d'alertes d'incidents, initialement développée par
Target et utilisée en production à grande échelle. Elle permet aux équipes de
définir des politiques d'escalade, des rotations et des plannings d'astreinte,
et d'envoyer des notifications sortantes par e-mail, webhook, ou (en option)
Twilio SMS/voix. Ce module déploie GoAlert sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par GoAlert et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte GoAlert sur RAD, et comment cela se compare {#what-goalert-costs-on-rad-and-how-that-compares}

**L'exécution de GoAlert dans votre propre projet Google Cloud coûte environ
101,74 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique
de 110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD).
GoAlert est une plateforme open-source de planification d'astreintes et
d'escalade d'alertes, développée par Target et utilisée en production à grande
échelle. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre
en pause gratuitement et le reprendre plus tard — voir "Mettre en pause
gratuitement" ci-dessous.

*GoAlert est également disponible sur GKE — consultez le [guide GKE](GoAlert_GKE.md)
si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre
l'option Cloud Run, moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une seule fois) | **99 crédits** (une seule fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une seule fois, par build) | ~3–6 crédits (une seule fois, par build) |
| Coût d'exécution Google Cloud | ~101,74 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~48 crédits/jour (~4,80 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1 vCPU / 0,5 Gio (alwaysOn) | 44,72 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **101,74 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officiellement hébergée/cloud de GoAlert à
  comparer, donc la comparaison honnête se fait avec une infrastructure
  auto-gérée, et non avec un SaaS concurrent.
- Un VPS nu dimensionné à environ 1 vCPU / 0,5 Gio — un Hetzner CPX22 (2
  vCPU/4 Go, ~24 $ US/mois), un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois),
  ou le propre Compute Engine e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois)
  — est généralement moins cher que le prix affiché par RAD ; un VPS d'une ou
  deux tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le
  système d'exploitation, faire tourner les sauvegardes de base de données,
  renouveler les certificats TLS et surveiller les temps d'arrêt. Les services
  Cloud SQL, Secret Manager et de surveillance gérés par RAD le font pour vous,
  ce qui est le véritable compromis, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est
  généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si GoAlert est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de
le payer entièrement sans le détruire. La suppression de ce projet délie
d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression du module GoAlert seul, cela ne
détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une :
l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il
attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Étant donné que rien n'a été
détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes — il s'agit d'une vérification, pas d'une reconstruction, et une
mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte
qu'une poignée de crédits de temps de build au total — environ 5 à 10 crédits,
moins de 1 $ US, pour une chaîne de déploiement typique de 2 à 3. Les frais de
module de 99 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le
palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google
indique que la plupart des services sont à nouveau entièrement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé GoAlert et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si GoAlert se trouve dans votre propre projet (ou si plus de 30 jours se sont
écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez
à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds :
environ **110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou
**99 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si GoAlert reste
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution : environ **4 jours ou plus** d'inactivité
dans votre propre projet (par rapport à sa facture Google Cloud d'environ
101,74 $ US/mois), ou **environ 3 jours ou plus** d'inactivité dans un projet
géré par RAD (par rapport à ses ~48 crédits/jour).

La majeure partie du coût d'exécution de GoAlert est la base de données et la
VM de fichier/cache partagée. Ils ne s'arrêtent que si rien d'autre dans le
projet ne les utilise, donc la suppression de cette application alors que
quelque chose d'autre partage le projet n'économise que la part de calcul de
cette application du total ci-dessus.

Priorité aux données : les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les
estimations de crédits quotidiens ; [documentation de Google sur la
suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

GoAlert s'exécute comme un seul binaire Go sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go, 1 vCPU / 512 Mio par défaut, `cpu_always_allocated = true`, `min_instance_count = 1` — pas de mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL (`POSTGRES_17`) | Requis — GoAlert ne prend pas en charge MySQL ou d'autres moteurs ; extension `pgcrypto` installée automatiquement |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré et clé de chiffrement des données ; mot de passe de la base de données géré par la fondation |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

Il n'y a **pas de ligne de stockage d'objets** dans ce tableau — la sortie
`GoAlert_Common` de `storage_buckets` est toujours `[]`. GoAlert n'a pas de
fonctionnalité de téléchargement de fichiers/pièces jointes ; chaque élément
d'état de l'application (politiques d'escalade, plannings, alertes, historique
des notifications, utilisateurs) réside dans PostgreSQL.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES_17"` est fixé par `GoAlert_Common` ;
  la sélection de tout autre moteur interrompt le démarrage.
- **CPU toujours actif, pas de mise à l'échelle à zéro.** `cpu_always_allocated = true` et
  `min_instance_count = 1` sont les valeurs par défaut car GoAlert exécute une boucle
  "moteur" continue en cours de processus qui évalue le timing de la politique
  d'escalade, l'état de rotation et l'envoi des notifications sortantes. Avec
  une facturation basée sur les requêtes ou à zéro instance, cette boucle ne
  s'exécute tout simplement pas — une alerte créée via API/webhook pourrait ne
  jamais être escaladée silencieusement.
- **`max_instance_count` reste à 1.** GoAlert prend officiellement en charge plusieurs
  instances de moteur concurrentes (pas un bug de double déclenchement selon la
  documentation en amont), mais recommande d'exécuter une instance en mode par
  défaut plus des réplicas `--api-only` supplémentaires pour éviter les
  conflits — une topologie à deux niveaux que ce module ne câble pas.
- **Pas de Redis, pas de stockage d'objets.** L'état de GoAlert réside
  entièrement dans PostgreSQL ; il n'a pas besoin de cache externe, de file
  d'attente ou de stockage de fichiers.
- **`GOALERT_DB_URL` est assemblé au démarrage du conteneur, pas au moment de la
  planification.** GoAlert n'accepte qu'une seule variable d'environnement de
  chaîne de connexion Postgres, et le `DB_PASSWORD` provenant de Secret Manager
  au moment de l'exécution ne peut pas être encodé en URL tant que le
  conteneur ne démarre pas réellement — `entrypoint.sh` (et chaque script de job
  d'initialisation) le construit à partir des valeurs `DB_*` discrètes
  injectées par la Fondation.
- **`public_url` calcule automatiquement une URL `run.app` lorsqu'il est laissé
  vide.** `GoAlert_CloudRun` transmet `public_url = var.public_url != "" ? var.public_url :
  "https://${service_name}-${project_number}.${region}.run.app"` à `GoAlert_Common`, de sorte
  que `GOALERT_PUBLIC_URL` (utilisé pour la validation OIDC/CSRF-referer et les liens
  dans les notifications sortantes) est correct dès la sortie de la boîte.
  Utilisez la sortie `service_url` : atteindre le service par l'autre nom d'hôte
  de Cloud Run (la forme de hachage affichée dans la console Cloud Run) fait
  échouer la vérification CSRF-referer de la première connexion — un navigateur
  est redirigé vers l'URL canonique, mais un client API codé en dur vers l'URL
  de la console échoue.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms des services et des ressources sont signalés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service GoAlert {#a-cloud-run--the-goalert-service}

GoAlert s'exécute en tant que service Cloud Run v2, toujours actif (minimum 1
instance, CPU toujours alloué) plutôt que mis à l'échelle à zéro, de sorte que
sa boucle de moteur d'escalade continue de fonctionner en permanence.

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

### B. Cloud SQL pour PostgreSQL {#b-cloud-sql-for-postgresql}

GoAlert stocke toutes les données de l'application — politiques d'escalade,
plannings, rotations, alertes, historique des notifications et utilisateurs —
dans une instance PostgreSQL Cloud SQL gérée. Le service se connecte
privatement via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP
publique n'est exposée. `entrypoint.sh` détecte le socket et le lie
symboliquement à `/tmp/.s.PGSQL.5432` avant d'assembler `GOALERT_DB_URL`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
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

### C. Secret Manager {#c-secret-manager}

Deux secrets sont générés automatiquement par `GoAlert_Common` et stockés dans Secret
Manager : le **mot de passe administrateur** (consommé par le job
d'initialisation `admin-bootstrap`) et une **clé de chiffrement des données**
(recommandée par la documentation GoAlert en amont pour chiffrer les clés API
stockées/la configuration sensible au repos, bien que non appliquée par le code
au démarrage). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application GoAlert {#3-goalert-application-behaviour}

- **La chaîne de jobs d'initialisation en 3 étapes est porteuse de charge.**
  `GoAlert_Common` définit trois jobs Cloud Run ordonnés, chacun dépendant du
  précédent, tous avec `execute_on_apply = true` :
  1. **`db-init`** (`postgres:15-alpine`) — crée le rôle et la base de données
     PostgreSQL.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`) — exécute
     `goalert migrate --db-url=...`, appliquant le propre schéma de GoAlert. Cela **doit**
     s'exécuter avant `admin-bootstrap` : `goalert add-user` n'a pas de logique de
     migration propre, et sur une base de données fraîche, il échoue avec
     `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — exécute
     `goalert add-user --admin` directement contre Postgres pour créer la première
     connexion administrateur. Sûr à exécuter au moment de l'apply (contrairement
     à un bootstrap basé sur HTTP) car il communique directement avec la base de
     données, pas avec le serveur en cours d'exécution.

  Les trois scripts réessayent en interne (jusqu'à 10 tentatives, espacées de
  5 secondes) pour absorber la latence de planification de Cloud SQL/Cloud Run
  Job, et les jobs Cloud Run eux-mêmes réessayent jusqu'à 3 fois en cas
  d'échec.

- **Pas d'assistant de configuration à la première visite.** GoAlert n'a pas de
  flux d'administration initial basé sur le web — le job `admin-bootstrap` est la
  seule façon de créer un compte administrateur. Récupérez le mot de passe
  généré :
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Point de terminaison de santé.** `/health` est le point de terminaison
  public, non authentifié et documenté de GoAlert (200 une fois que le cycle de
  vie de l'application quitte l'état "Starting"). Les sondes de démarrage et de
  vivacité de ce module utilisent par défaut une vérification de port **TCP**
  plutôt qu'une vérification de chemin HTTP — une valeur par défaut
  conservatrice correspondant au modèle établi de ce catalogue — et les deux se
  sont avérées correctes lors de la vérification en direct (HTTP 200 sur
  `/health` avec de vraies lignes de journal "listening and serving HTTP").

- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
GoAlert sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par exemple `cr`) de tout `GoAlert_GKE` (`gke`) co-déployé pour éviter une collision de noms. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `goalert` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `GoAlert` | Nom lisible par l'homme affiché dans la Console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image. `"latest"` correspond à un argument de build Dockerfile épinglé (`GOALERT_VERSION = v0.34.1`), correspondant à la propre recommandation d'upstream contre `latest`/`nightly` nus en production. |
| `admin_username` | `admin` | Nom d'utilisateur créé par le job d'initialisation `admin-bootstrap`. Véritablement transmis via `goalert.tf` dans `GoAlert_Common`. |
| `admin_email` | `admin@techequity.cloud` | E-mail pour le compte administrateur initial. |
| `public_url` | `""` | Laissé vide, calcule automatiquement `https://<service>-<project-number>.<region>.run.app`. Utilisé pour la validation OIDC/CSRF-referer et les liens de notification sortants. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU est suffisant pour le binaire Go de GoAlert. |
| `memory_limit` | `512Mi` | Plancher dur Gen2, indépendant de `cpu_always_allocated`. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué pendant toute la durée de vie d'une instance RUNNING — requis pour la boucle continue du moteur d'escalade. |
| `min_instance_count` | `1` | Pas de mise à l'échelle à zéro — à zéro instance, le moteur d'escalade ne s'exécute pas du tout. |
| `max_instance_count` | `1` | Instance de moteur unique en mode par défaut ; multi-instance nécessite une topologie `--api-only` que ce module ne câble pas. |
| `container_port` | `8081` | Port HTTP natif de GoAlert (`GOALERT_LISTEN`). |
| `execution_environment` | `gen2` | Environnement d'exécution requis. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `true` | Sidecar de socket Unix du proxy d'authentification Cloud SQL. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du conteneur pour le socket du proxy d'authentification. |
| `container_protocol` | `http1` | `"http1"` ou `"h2c"`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base GoAlert dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Contrôle d'ingress du trafic. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Contrôle d'egress VPC. |
| `enable_iap` | `false` | Proxy conscient de l'identité. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GOALERT_LISTEN` et `GOALERT_PUBLIC_URL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Moteur Cloud SQL. GoAlert nécessite PostgreSQL. |
| `db_name` | `goalert` | Nom de la base de données PostgreSQL. |
| `db_user` | `goalert` | Utilisateur de l'application PostgreSQL. |
| `db_password_env_var_name` | `""` | **Valeur par défaut copiée-collée d'un modèle précédent.** Additive selon la sémantique de la Fondation — injecte une variable d'environnement secrète supplémentaire inutilisée à côté du `DB_PASSWORD` standard que le point d'entrée de GoAlert lit réellement. Inoffensif ; effacez-le à `""` si cela vous dérange. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour la chaîne de 3 jobs par défaut de `GoAlert_Common` (`db-init` → `db-migrate` → `admin-bootstrap`). Une liste non vide la remplace entièrement — vous prenez en charge l'ordre et le contenu. |
| `cron_jobs` | `[]` | GoAlert n'a pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, 30 tentatives | S'adapte à la latence de migration au premier démarrage (`db-migrate`). |
| `liveness_probe` | désactivé | Cloud Run redémarre le conteneur à la sortie du processus ; la sonde de démarrage contrôle la disponibilité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis par GoAlert ; présent pour la compatibilité de la plateforme. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Intégration standard `App_CloudRun` VPC-SC — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours `[]` — GoAlert ne provisionne aucun bucket de stockage. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs et les combinaisons au moment de la planification. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critique | Tout autre moteur rompt entièrement le schéma et le démarrage de GoAlert — `pgcrypto` et l'ensemble du flux `goalert migrate` sont spécifiques à Postgres. |
| Ordre `initialization_jobs` (`db-init` → `db-migrate` → `admin-bootstrap`) | Laissez `[]` à moins que vous ne compreniez parfaitement la chaîne de dépendances | Critique | L'exécution de `admin-bootstrap` avant `db-migrate` échoue avec `relation "auth_basic_users" does not exist` sur une base de données fraîche — `goalert add-user` n'a pas de logique de migration propre. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` | Élevé | Le moteur de synchronisation d'escalade de GoAlert est une boucle continue en cours de processus — à zéro instance, ou sous une facturation basée sur les requêtes avec limitation du CPU, les escalades pour les alertes réelles peuvent être silencieusement retardées ou manquées entièrement. |
| `public_url` | Laissez `""` (calculé automatiquement) ou définissez l'URL externe réelle | Élevé | Une URL `GOALERT_PUBLIC_URL` incorrecte rompt les rappels d'authentification OIDC et chaque lien dans les e-mails de notification sortants (revient au propre `http://localhost:8081` de GoAlert s'il n'est pas réellement défini en aval). |
| `admin_username` / `admin_email` | Définir une fois, récupérer le mot de passe de Secret Manager | Moyen | GoAlert n'a pas de flux de réinitialisation de mot de passe en libre-service visible depuis Terraform ; perdre la trace des identifiants administrateur amorcés signifie utiliser la CLI `goalert` directement contre la base de données pour en créer un nouveau. |
| `max_instance_count` | `1` à moins que vous ne câbliez une topologie `--api-only` | Moyen | GoAlert prend en charge plusieurs instances de moteur en toute sécurité (pas un bug de double déclenchement selon la documentation en amont), mais ce module n'a pas de mécanisme intégré pour désigner les réplicas `--api-only`, donc la mise à l'échelle au-delà de 1 sans ce câblage supplémentaire exécute simplement plusieurs instances de moteur complètes. |
| `db_password_env_var_name` | Laissez tel quel ou effacez à `""` | Faible | Le `LISTMONK_db__password` par défaut est un résidu inerte d'un modèle d'un autre module — inoffensif, mais déroutant si vous le cherchez dans la configuration réelle de GoAlert. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à GoAlert partagée avec la variante GKE est décrite
dans **[GoAlert_Common](GoAlert_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoAlert sur Cloud Run](../labs/GoAlert_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GoAlert sur GKE Autopilot](GoAlert_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [GoAlert Common — Configuration d'application partagée](GoAlert_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) dans la solution **Observabilité et astreinte**.
