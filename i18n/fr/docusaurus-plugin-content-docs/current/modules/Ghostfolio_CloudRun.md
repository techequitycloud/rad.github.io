---
title: "Ghostfolio sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Ghostfolio sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ghostfolio_CloudRun.md @ 40c83c3f sha256:09aedce2c732 -->

# Ghostfolio sur Google Cloud Run {#ghostfolio-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghostfolio_CloudRun.png" alt="Ghostfolio sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghostfolio est une application open source de gestion de patrimoine sous licence
AGPL, permettant de suivre la valeur nette, les portefeuilles d'investissement et
l'allocation d'actifs sur plusieurs comptes de courtage et plateformes — une
alternative axée sur la confidentialité aux outils commerciaux de suivi de
portefeuille. Ce module déploie Ghostfolio sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Ghostfolio et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Ghostfolio sur RAD et comparaison {#what-ghostfolio-costs-on-rad-and-how-that-compares}

**L'exécution de Ghostfolio dans votre propre projet Google Cloud coûte environ
82,03 US$/mois en frais Google Cloud, en plus d'un frais de module RAD unique de
110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD).
Ghostfolio est une application open source de gestion de patrimoine pour suivre
la valeur nette, les portefeuilles d'investissement et l'allocation d'actifs sur
plusieurs comptes et plateformes. Si vous déployez dans un projet géré par RAD,
vous pouvez tout mettre en pause gratuitement et reprendre plus tard — voir
« Mettre en pause gratuitement » ci-dessous.

*Ghostfolio est également disponible sur GKE — consultez le [guide GKE](Ghostfolio_GKE.md)
si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre
l'option Cloud Run, moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une fois) | **99 crédits** (une fois, 10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build. | Idem |
| Coût d'exécution Google Cloud | ~82,03 US$/mois, facturé sur votre propre compte de facturation Google au prix catalogue | ~67 crédits/jour (~6,70 US$/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que
soit le montant : une fois par compte, pour un module que vous déployez et payez
vous-même (dans une solution, les frais d'une application : la première à
réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (scaleToZero) | 11,58 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **82,03 US$** |

### Comparaison {#how-it-compares}

- Il n'existe pas de version officielle hébergée/cloud de Ghostfolio à comparer,
  donc la comparaison honnête se fait avec une infrastructure autogérée, et non
  avec un SaaS concurrent.
- Un VPS nu dimensionné à environ 1 vCPU / 1 Gio — un Hetzner CPX22 (2 vCPU/4Go,
  ~24 US$/mois), un DigitalOcean 2 vCPU/4Go Droplet (24 US$/mois), ou le propre
  Compute Engine e2-standard-2 de GCP (2 vCPU/8Go, ~49 US$/mois) — est
  généralement moins cher que le prix affiché de RAD ; un VPS d'une ou deux
  tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le
  système d'exploitation, faire tourner les sauvegardes de bases de données,
  renouveler les certificats TLS et surveiller les temps d'arrêt. Cloud SQL,
  Secret Manager et la surveillance gérés par RAD le font pour vous, ce qui est
  le véritable échange, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes monétaires — ce
  n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Ghostfolio est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de
le payer entièrement sans le détruire. La suppression de ce projet délie
d'abord sa facturation, puis demande à Google de supprimer le projet
définitivement — la suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression du module Ghostfolio seul, cela ne détruit pas
Cloud SQL, aucune VM ou la ressource de calcul une par une : le projet entier
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.**
> Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou
> les ressources qu'il contient, seront utilisables après sa restauration, de
> sorte que la restauration ne peut pas être invoquée comme moyen de récupérer
> un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des
> sauvegardes appropriées des données et de la configuration de l'application et
> de les avoir stockées en dehors du projet. Si une restauration échoue, ou si
> le projet restauré ne fonctionne pas, la solution de repli consiste à
> redéployer l'application (voir la section suivante) et à restaurer sa
> configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Les mises à jour sont incluses dans le
prix (5 par mois pour chaque déploiement), donc une restauration ne coûte
normalement aucun crédit. Les frais de module de 99 crédits ne sont pas
facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
affirme que la plupart des services sont de nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé Ghostfolio et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Ghostfolio se trouve dans votre propre projet (ou si plus de 30 jours se sont
écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez
à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) :
110 crédits (11,00 US$) dans votre propre projet, ou **99 crédits** sur un
projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Ghostfolio reste
inutilisé suffisamment longtemps pour que le coût de redéploiement soit
inférieur à son propre coût d'exécution : environ **5 jours ou plus** d'inactivité
dans votre propre projet (par rapport à sa facture Google Cloud d'environ
82,03 US$/mois), ou **environ 4 jours ou plus** d'inactivité dans un projet géré
par RAD (par rapport à ses ~67 crédits/jour).

La majeure partie du coût d'exécution de Ghostfolio est la base de données et la
VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le
projet ne les utilise, donc la suppression de cette application alors que
quelque chose d'autre partage le projet n'économise que la part de calcul de
cette application sur le total ci-dessus.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible, la
  facturation est suspendue et les données sont conservées, de sorte que
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

Ghostfolio s'exécute comme un conteneur NestJS (Prisma ORM) sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | API NestJS + frontend Angular servis depuis un conteneur, 1 vCPU / 1 Gio par défaut, facturation basée sur les requêtes, mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — l'ORM Prisma de Ghostfolio ne prend pas en charge MySQL |
| Cache et file d'attente | Redis (**requis**, non optionnel) | Mise en cache des données de marché, sessions et gestion des files d'attente/jobs Bull |
| Secrets | Secret Manager | `ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; l'ORM Prisma de Ghostfolio ne prend pas en
  charge d'autres moteurs.
- **Redis est obligatoire, non optionnel.** Contrairement à de nombreuses
  applications de ce catalogue où Redis est une fonctionnalité de performance
  optionnelle, le point de terminaison de santé de Ghostfolio vérifie lui-même
  la connectivité Redis et l'application ne servira pas de trafic réel sans
  elle.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. Les deux bloquent le démarrage — Ghostfolio n'a
  pas de valeur par défaut saine pour l'un ou l'autre. La rotation de `ACCESS_TOKEN_SALT`
  après le premier démarrage invalide chaque jeton de sécurité précédemment émis
  (voir §3).
- **Pas de compte administrateur pré-rempli.** Ghostfolio n'a pas de formulaire
  de connexion email/mot de passe ni d'assistant de configuration de première
  exécution à remplir — le premier visiteur de l'URL déployée clique sur « Get
  Started » et l'application crée un jeton de sécurité anonyme aléatoire comme
  propriétaire du compte.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). L'API de Ghostfolio est purement requête/réponse sans
  planificateur d'arrière-plan en cours d'exécution, de sorte que la facturation
  basée sur les requêtes s'applique proprement.
- **Aucun stockage de fichiers/médias en masse n'est provisionné.** Ghostfolio
  n'a pas d'équivalent aux pièces jointes téléchargées par l'utilisateur ;
  `storage_buckets` est toujours vide.
- **`DATABASE_URL` est composé à l'exécution, jamais via un socket Unix.** La
  chaîne de connexion Prisma de Ghostfolio est un DSN d'autorité d'URL
  (`postgresql://user:pass@host:port/db`), et les deux-points d'un chemin de socket Cloud SQL
  cassent ce format — le point d'entrée cloud du conteneur se connecte toujours
  sur TCP en utilisant l'IP privée de Cloud SQL, avec `sslmode=require`.
- **`application_version = "latest"` est réellement valide.** Contrairement à plusieurs autres
  modules d'images pré-construites de ce catalogue, le `ghostfolio/ghostfolio` de Docker
  Hub publie une vraie balise `latest`, donc aucune solution de contournement
  de version n'est requise (le verrouillage de version est toujours recommandé
  pour des builds reproductibles).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Ghostfolio {#a-cloud-run--the-ghostfolio-service}

Ghostfolio s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge des requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

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

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Ghostfolio stocke toutes les données de l'application (comptes, avoirs,
activités, cache de données de marché, enregistrements d'utilisateurs) dans une
instance Cloud SQL pour PostgreSQL 15 gérée. Lors du premier déploiement, un job
d'initialisation crée la base de données et le rôle de l'application ; le point
d'entrée du conteneur de Ghostfolio exécute les migrations Prisma à chaque
démarrage ultérieur.

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

### C. Redis (requis) {#c-redis-required}

Redis prend en charge la mise en cache des données de marché, les sessions et la
gestion des files d'attente/jobs Bull — Ghostfolio ne démarrera pas
correctement sans une instance Redis accessible. Lorsque `redis_host` est laissé
vide, l'IP de la VM NFS de la plateforme est utilisée comme point de terminaison
Redis (nécessite `enable_nfs = true` ou un serveur NFS `Services_GCP` découvert).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the running revision's Redis env vars:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `ACCESS_TOKEN_SALT` (hache le credential de connexion du jeton de
sécurité anonyme) et `JWT_SECRET_KEY` (signe les JWT d'authentification). Le mot de
passe de la base de données est géré séparément par la fondation.

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
peuvent être ajoutés ; les paramètres d'ingress et de sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ghostfolio {#3-ghostfolio-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se
  connecte à Cloud SQL et crée de manière idempotente le rôle, la base de
  données et les autorisations de l'application. Le job peut être réexécuté en
  toute sécurité.
- **Les migrations et le seeding s'exécutent à CHAQUE démarrage du conteneur**,
  dans le même processus que le serveur — et non comme un job d'initialisation
  séparé. Le `docker/entrypoint.sh` amont exécute `prisma migrate deploy`, puis `prisma db seed`,
  puis démarre le serveur NestJS. Une migration échouée fait planter le
  conteneur bruyamment (le script amont utilise `set -ex`) plutôt que de
  fournir un service sain avec une base de données vide.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont immuables après le premier démarrage.**
  Ceux-ci sont générés une fois et écrits dans Secret Manager. `ACCESS_TOKEN_SALT`
  hache le jeton de sécurité anonyme — sa rotation invalide chaque jeton
  précédemment émis (les utilisateurs doivent se réinscrire). `JWT_SECRET_KEY`
  signe les JWT de session — sa rotation déconnecte tout le monde.
- **Pas de formulaire de première exécution à remplir.** Le premier visiteur de
  l'URL déployée voit un bouton « Get Started » ; en cliquant dessus, un jeton
  de sécurité aléatoire est créé et devient le credential de connexion du
  propriétaire du compte. Il n'y a pas d'email/mot de passe à définir ni de
  compte administrateur à initialiser.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /api/v1/health`, qui vérifie À LA FOIS la base de données ET les connexions
  Redis et renvoie `503` jusqu'à ce que les deux soient sains — cela
  sert également de véritable porte de disponibilité, pas seulement un ping de
  vivacité.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Ghostfolio sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Ghostfolio` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de suivi du déploiement. Le `ghostfolio/ghostfolio` de Docker Hub publie un vrai tag `latest`, donc celui-ci est directement utilisable — épingler à une version spécifique (par exemple `2.153.0`) pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU est suffisant pour une utilisation typique. |
| `memory_limit` | `1Gi` | 1 Gio est suffisant pour une utilisation typique. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro — l'API de Ghostfolio est purement requête/réponse. |
| `container_port` | `3333` | `DEFAULT_PORT` de Ghostfolio (`libs/common/src/lib/config.ts`). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — pas de planificateur d'arrière-plan en cours d'exécution à limiter. |
| `enable_cloudsql_volume` | `true` | Monte un sidecar Cloud SQL Auth Proxy, mais le point d'entrée cloud de Ghostfolio ne se connecte jamais directement via le chemin du socket — voir §1. |
| `container_image_source` | `custom` | Cloud Build enveloppe l'image pré-construite `ghostfolio/ghostfolio` avec un point d'entrée cloud léger. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DATABASE_URL`, `PORT` et `REDIS_PASSWORD` (alias de `REDIS_AUTH`) sont composés par le point d'entrée cloud — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, une clé API de fournisseur de données de marché personnalisée). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `ghostfolio` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `ghostfolio` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Aucun job de migration séparé n'existe — les migrations s'exécutent à l'intérieur du conteneur de l'application à chaque démarrage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/health`, délai de 30s, seuil de 12 échecs | Vérifie la connectivité de la base de données ET de Redis. |
| `liveness_probe` | HTTP `/api/v1/health`, délai de 30s, seuil de 3 échecs | Même point de terminaison que la sonde de démarrage. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | REQUIS — toujours transférer inconditionnellement, ne jamais conditionner à `redis_host != ""`. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `"6379"` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis (sensible). Aliasé à l'exécution sur la propre variable d'environnement `REDIS_PASSWORD` de Ghostfolio. |

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
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — Ghostfolio n'a pas besoin de stockage de fichiers/médias en masse. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Sa rotation invalide chaque jeton de sécurité précédemment émis — chaque utilisateur doit se réinscrire. |
| `JWT_SECRET_KEY` (auto-généré) | Ne faire pivoter que pendant une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions actives, forçant une reconnexion immédiate. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_redis` | `true`, toujours transféré inconditionnellement | Critique | Le point de terminaison de santé de Ghostfolio vérifie Redis directement — sans cela, l'application ne signale jamais être saine, quelle que soit `redis_host`. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais qu'aucun hôte ne se résout (NFS désactivé, pas d'hôte explicite), `REDIS_HOST` est vide et l'application échoue à son propre contrôle de santé. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `application_version` | Épingler pour la production | Moyen | `latest` est réellement valide ici (contrairement à la plupart des modules), mais flotte toujours vers ce que Docker Hub taggue actuellement comme latest — épingler pour des déploiements reproductibles. |
| `min_instance_count` | `0` convient à la plupart des déploiements | Faible | La mise à l'échelle à zéro ajoute un bref délai de démarrage à froid lors de la première requête après l'inactivité ; définir `1` uniquement si cette latence est importante. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Ghostfolio partagée avec la variante GKE est décrite
dans **[Ghostfolio_Common](Ghostfolio_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ghostfolio sur Cloud Run](../labs/Ghostfolio_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Ghostfolio sur GKE Autopilot](Ghostfolio_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ghostfolio Common — Configuration d'application partagée](Ghostfolio_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md), [Wallos sur Google Cloud Run](Wallos_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Suivi des finances et du patrimoine**.
