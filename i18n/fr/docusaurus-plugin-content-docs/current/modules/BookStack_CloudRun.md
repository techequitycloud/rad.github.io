---
title: "BookStack sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de BookStack sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/BookStack_CloudRun.md @ 1665a43e sha256:0c28494c31b2 -->

# BookStack sur Google Cloud Run {#bookstack-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/BookStack_CloudRun.png" alt="BookStack sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

BookStack est une plateforme de wiki et de documentation gratuite, open source, sous
licence MIT, construite sur Laravel (PHP). Elle organise le contenu en Étagères →
Livres → Chapitres → Pages avec édition WYSIWYG et Markdown, recherche en texte
intégral, révisions de pages et permissions granulaires. Ce module déploie BookStack
sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par BookStack et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à chaque application Cloud Run — identité
de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — veuillez vous référer au [guide du socle
App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte BookStack sur RAD, et comparaison {#what-bookstack-costs-on-rad-and-how-that-compares}

**BookStack sur le module Cloud Run de RAD coûte environ 84 $ US par mois dans votre
propre projet Google Cloud, sans frais de licence supplémentaires** — BookStack est
open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé
à **32 crédits par jour** (environ 960 par mois, soit environ 96 $ US au prix de la
recharge). Ou consultez le [guide GKE](BookStack_GKE.md) pour une capacité toujours
active sur plusieurs pods. Si vous n'avez besoin de BookStack qu'occasionnellement
— études, démo, projet de courte durée — un projet géré par RAD peut être supprimé
et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre
mensuel devient quelques dollars à la place. Voir **Mettre en pause gratuitement**,
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

BookStack est open source, il n'y a donc pas de frais de licence. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et
le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue
Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 84 $ US** |

Les prix de Cloud SQL et des pods Cloud Run/GKE sont les mêmes dans
africa-south1 (Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **La mise à l'échelle à zéro est la valeur par défaut sur Cloud Run.** Le chiffre
  ci-dessus suppose une utilisation quotidienne modeste ; définissez `min_instance_count ≥ 1` pour le
  maintenir toujours chaud (et éviter les démarrages à froid), ce qui augmente la
  ligne Cloud Run mais pas le reste du tableau.

### Comparaison pour le wiki d'une petite équipe {#how-it-compares-for-a-small-teams-wiki}

Le projet BookStack lui-même ne vend pas d'hébergement ; une poignée de
fournisseurs tiers listent l'hébergement BookStack sur la page des sponsors de
bookstackapp.com, mais RAD n'a pas obtenu de prix actuel de leur part, donc aucun
n'est cité ici. La comparaison qui peut être vérifiée est un serveur nu :

- Un Hetzner CPX22 ou un droplet DigitalOcean (2 vCPU/4 Go, environ 24 $/mois) ou
  un GCP e2-standard-2 (2 vCPU/8 Go, environ 49 $/mois) exécuterait BookStack et
  sa base de données MySQL.
- Sur un VPS nu, vous gérez vous-même MySQL, les sauvegardes, les correctifs de
  sécurité et les mises à niveau. Le module de RAD vous offre Cloud SQL géré,
  Secret Manager et Cloud Monitoring pour les frais de module plus l'utilisation
  de Google Cloud ci-dessus.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si BookStack s'exécute dans **un projet géré par RAD pour vous**, la suppression de
l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord
sa facturation, puis demande à Google de supprimer le projet purement et simplement.
Google le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà
déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression
d'un module, cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une
par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut demander à Google de récupérer le projet et
  de rattacher son compte de facturation, puis d'exécuter **Mettre à jour** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes, et une mise à jour ne facture jamais les frais de module à nouveau.
  Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte
  qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 $ US).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD
  gère uniquement la facturation), le restaurer vous-même dans les 30 jours — après
  quoi Google le supprime définitivement — et atteindre à nouveau le seuil
  d'admission du palier (100 crédits pour le palier sandbox qui convient à la
  plupart des utilisations d'étude/démo). Google indique que la plupart des
  services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une
  restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
  la suppression logicielle de Cloud Storage désactivée, il est donc très probable
  qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est
  récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un
  bucket en dehors du projet) avant de supprimer s'il y a quelque chose à
  conserver ; pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
mentionnée ci-dessus est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds
  : environ 79 crédits (environ 7,90 $ US) au prix de la recharge, et environ 15 à
  20 minutes de temps de build (moyenne de la propre plateforme de RAD). La
  suppression ne permet d'économiser de l'argent que si BookStack devait rester
  inutilisé pendant environ **3 jours ou plus** — dans votre propre projet, cela
  représente environ 2,79 $ US par jour, et dans un projet géré par RAD, c'est 32
  crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données
  et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que si
  rien d'autre dans le projet ne les utilise, donc la suppression de BookStack
  tandis qu'une autre application partage le projet n'économise que la partie
  calcul de BookStack.
- **Conserver les données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
  dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
  et règle directement avec le client. Si le portefeuille est faible, la
  facturation est suspendue et les données sont conservées, de sorte que personne
  ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et
  les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde concernant le bucket de
sauvegarde ; les prix changent, vérifiez chaque source avant de vous fier à un
chiffre.

## 1. Vue d'ensemble {#1-overview}

BookStack s'exécute comme un conteneur PHP sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur PHP (LinuxServer), 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — BookStack ne prend pas en charge PostgreSQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié (`gcs-bookstack<tenant>-data`) provisionné automatiquement |
| Fichiers persistants | Filestore / NFS | Images et pièces jointes téléchargées persistantes à `/var/lib/bookstack` |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; BookStack utilise le pilote de cache/session local |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-générée ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`database_type = "MYSQL_8_0"`) ; PostgreSQL n'est pas pris en charge et
  la sélection d'un autre moteur interrompt le démarrage.
- **L'image `linuxserver/bookstack` pré-construite est utilisée directement.** Il n'y a pas de
  Cloud Build personnalisé pour le déploiement par défaut ; l'image officielle
  LinuxServer.io est mise en miroir dans Artifact Registry (`enable_image_mirroring = true`) et déployée
  telle quelle.
- **Le conteneur écoute sur le port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **La persistance NFS des téléchargements est activée par défaut.** `enable_nfs = true` monte
  NFS à `/var/lib/bookstack` afin que les images et pièces jointes téléchargées survivent aux
  redémarrages, redéploiements et événements de mise à l'échelle. La désactivation
  entraîne la perte des fichiers téléchargés.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max_instance_count = 1`). Les
  démarrages à froid ajoutent quelques secondes de latence à la première requête
  après l'inactivité ; BookStack est un wiki purement requête/réponse sans
  travailleurs en arrière-plan, donc la facturation basée sur les requêtes
  (`cpu_always_allocated = false`) est correcte.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une fois et stockée dans Secret Manager ; sa rotation rend toutes
  les valeurs chiffrées de la base de données (secrets à deux facteurs, certains
  paramètres) indéchiffrables.
- **L'image exécute `php artisan migrate --force` automatiquement au démarrage**, de sorte que le schéma
  est créé au premier démarrage après que `db-init` ait provisionné la base de
  données et l'utilisateur — il n'y a pas de job de migration séparé.
- **Un administrateur par défaut est initialisé** par l'image LinuxServer :
  `admin@admin.com` avec le mot de passe `password`. Changez-le immédiatement lors de la
  première connexion.
- **Cloud Run se connecte à Cloud SQL via TCP IP privée.** `enable_cloudsql_volume = false` par défaut,
  donc `DB_HOST` est l'IP privée de l'instance ; MySQL sur TCP IP privée n'a pas
  besoin de SSL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service BookStack {#a-cloud-run--the-bookstack-service}

BookStack s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge des requêtes entre le nombre minimal et maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre
les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

BookStack stocke toutes les données de l'application (livres, pages, utilisateurs,
révisions, permissions) dans une instance Cloud SQL pour MySQL 8.0 gérée. Le
service se connecte via l'**IP privée** de Cloud SQL via l'egress VPC (`enable_cloudsql_volume = false`) ;
`DB_HOST` est défini sur l'IP privée de l'instance et aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée la base de
données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la
rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (`storage_buckets` par défaut : `name_suffix = "data"`, résultant en
`gcs-bookstack<tenant>-data`) est provisionné automatiquement. Des buckets supplémentaires peuvent être
déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/       # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache et sessions facultatifs) {#d-redis-optional-cache--sessions}

Redis est **désactivé par défaut** (`enable_redis = false`) ; BookStack utilise ses pilotes de
cache et de session locaux. Lorsque `enable_redis = true` est défini, la couche partagée injecte
`REDIS_HOST` et `REDIS_PORT` afin que BookStack puisse utiliser Redis pour le cache et les
sessions. Lorsque `redis_host` est laissé vide et `enable_nfs` est vrai, l'IP Redis co-hébergée
de la VM du serveur NFS est utilisée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the DB wiring in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -E 'DB_|REDIS_'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager
: la **`APP_KEY`** Laravel (`base64:<44-char base64>`), utilisée pour chiffrer toutes les données
d'application que BookStack stocke chiffrées. Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`), ce qui permet
l'accès public attendu d'un wiki partagé. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ;
les paramètres d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application BookStack {#3-bookstack-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il détecte le socket Cloud
  SQL ou le point de terminaison TCP, attend que MySQL soit accessible, crée la
  base de données et l'utilisateur de l'application, accorde les privilèges,
  vérifie que l'utilisateur de l'application peut se connecter et arrête
  gracieusement le sidecar Cloud SQL Auth Proxy. Le job est idempotent et peut
  être réexécuté en toute sécurité (`max_retries = 3`).
- **Auto-migration du schéma au démarrage.** L'image LinuxServer BookStack exécute
  `php artisan migrate --force` automatiquement à chaque démarrage de conteneur, de sorte que le schéma
  est créé au premier démarrage et mis à niveau aux démarrages ultérieurs — il
  n'y a **pas de job de migration séparé**.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une fois et écrite dans Secret Manager. La faire pivoter rend toutes
  les valeurs chiffrées de la base de données (secrets à deux facteurs, certains
  paramètres) définitivement indéchiffrables. Ne la faites pivoter que pendant
  une fenêtre de maintenance planifiée avec un plan de rechiffrement.
- **Administrateur de première exécution.** L'image initialise un compte
  administrateur par défaut, `admin@admin.com` / `password`. Changez le mot de passe (et
  idéalement l'e-mail) immédiatement après la première connexion.
- **Les fichiers téléchargés résident sur NFS.** Les images, les pièces jointes et
  autres téléchargements sont stockés sur le système de fichiers sous `/var/lib/bookstack`, qui
  est par défaut sauvegardé par NFS afin qu'ils survivent aux redémarrages,
  redéploiements et mises à l'échelle à zéro.
- **Chemin de santé.** La sonde de vivacité cible `/status` — le point de terminaison
  de santé JSON non authentifié de BookStack qui rapporte l'état de
  l'application/base de données/cache/session. La sonde de démarrage est une
  vérification TCP sur le port 80. Prévoyez une fenêtre généreuse pour le premier
  démarrage : la sonde de vivacité a un délai initial de 300 secondes pour tenir
  compte des migrations automatiques.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
BookStack sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `bookstack` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `BookStack` | Nom lisible par l'homme affiché dans la console. |
| `description` | `BookStack wiki on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag d'image `linuxserver/bookstack` ; épingler (par exemple `version-v24.10`) en production. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | `512M` / `64M` / `64M` | Indices de réglage PHP ; inertes pour l'image LinuxServer par défaut. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déployer directement l'image LinuxServer mise en miroir — pas de build personnalisé. |
| `container_image` | `""` | Remplacer la référence d'image ; laisser vide pour utiliser la valeur par défaut mise en miroir. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU par défaut. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Garder à 1 — BookStack n'a pas de coordination de file d'attente multi-instances. |
| `container_port` | `80` | BookStack écoute sur le port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Connexion via TCP IP privée Cloud SQL (correct pour MySQL sur Cloud Run). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image LinuxServer dans Artifact Registry. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Ingress et VPC {#group-5--ingress--vpc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet l'accès public pour le wiki. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les lecteurs anonymes.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `APP_URL`, configuration de messagerie). Ne pas définir `APP_KEY` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après
le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor, CDN et domaine personnalisé {#group-10--cloud-armor-cdn--custom-domain}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket `data` par défaut et tous ceux de `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS à provisionner. |
| `enable_nfs` | `true` | Persister les images/pièces jointes téléchargées sur NFS. |
| `nfs_mount_path` | `/var/lib/bookstack` | Chemin de montage où BookStack stocke les téléchargements. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — BookStack nécessite MySQL 8.0. |
| `db_name` | `bookstack` | Nom de la base de données MySQL (préfixé par le locataire). Immuable après le premier déploiement. |
| `db_user` | `bookstack` | Utilisateur de la base de données de l'application (préfixé par le locataire). Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Rotation du mot de passe de la base de données. |

### Groupe 13 — Automatisation des charges de travail {#group-13--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | BookStack n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 80, délai 30s | Sonde de démarrage (vérification d'écoute de port). |
| `liveness_probe` | HTTP `/status`, délai 300s | Sonde de vivacité contre le point de terminaison de santé non authentifié. |
| `uptime_check_config` | `{ enabled=false, path="/status" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte métrique. |

### Groupe 21 — Cache et sessions Redis {#group-21--redis-cache--sessions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Injecter `REDIS_HOST`/`REDIS_PORT` afin que BookStack puisse utiliser Redis pour le cache/les sessions. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

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
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée, sensible) / port. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec
> des montages NFS/GCS, un `database_type` qui ne correspond pas au moteur requis par
> BookStack, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont
> plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les valeurs chiffrées de la base de données (secrets à deux facteurs, certains paramètres) définitivement indéchiffrables. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `database_type` | `MYSQL_8_0` | Critique | BookStack nécessite MySQL ; tout autre moteur interrompt le démarrage. |
| `APP_URL` (via `environment_variables`) | URL de service réelle | Élevé | Une URL de base incorrecte interrompt le chargement des actifs, les liens et les redirections de connexion. |
| `enable_nfs` | `true` | Élevé | La désactivation entraîne la perte de toutes les images et pièces jointes téléchargées lors du redéploiement ou de la mise à l'échelle à zéro. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures risquent des arrêts OOM lors de l'édition concurrente et de l'indexation en texte intégral. |
| `enable_cloudsql_volume` | `false` (TCP IP privée) | Élevé | Sur Cloud Run, BookStack se connecte via TCP IP privée ; forcer le chemin du socket est inutile et peut interrompre la connectivité de la base de données. |
| `ingress_settings` | `all` | Élevé | La définition à `internal` bloque tous les lecteurs externes du wiki. |
| `enable_iap` | uniquement lorsque les lecteurs doivent s'authentifier | Élevé | IAP bloque tout accès anonyme, y compris les lecteurs de documentation publique. |
| `max_instance_count` | `1` | Moyen | BookStack n'a pas de coordination multi-instances ; la mise à l'échelle risque une incohérence du cache/des sessions. |
| `min_instance_count` | `0` (CR) | Moyen | La mise à l'échelle à zéro ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| `admin@admin.com` mot de passe par défaut | Changer lors de la première connexion | Moyen | Laisser le `password` par défaut permet à quiconque ayant l'URL de se connecter en tant qu'administrateur. |
| `backup_retention_days` | `7` (augmenter pour la prod) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement du socle référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
BookStack partagée avec la variante GKE est décrite dans
**[BookStack_Common](BookStack_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : BookStack sur Cloud Run](../labs/BookStack_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [BookStack sur GKE Autopilot](BookStack_GKE.md) — la même application sur Kubernetes, pour les cas où vous avez besoin de l'autre cible de déploiement.
- [BookStack Common — Configuration d'application partagée](BookStack_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Gotify sur Google Cloud Run](Gotify_CloudRun.md) dans la solution **Customer Support Desk**.
