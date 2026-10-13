---
title: "Cyclos sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Cyclos sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Cyclos_CloudRun.md @ e69407af sha256:0a67e7011881 -->

# Cyclos sur Google Cloud Run {#cyclos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_CloudRun.png" alt="Cyclos sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cyclos est une plateforme bancaire et de paiement riche en fonctionnalités, utilisée par
les institutions de microfinance, les coopératives de crédit et les réseaux de monnaies
complémentaires. Ce module déploie Cyclos sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud utilisés par Cyclos et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à chaque application Cloud Run — identité de service, ingress et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Cyclos sur RAD, et comment cela se compare {#what-cyclos-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Cyclos sur RAD coûte environ 76,75 $ US par mois dans un projet
Google Cloud que vous possédez, plus des frais de module uniques de 110 crédits (11 $ US).**
Cyclos est une plateforme bancaire et de paiement utilisée par les institutions de
microfinance, les coopératives de crédit et les réseaux de monnaies communautaires. GKE
Autopilot convient aux instances de Cyclos qui doivent rester actives, s'adapter à
travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour
le coût le plus bas, ce module Cloud Run est généralement le bon choix — voir le
[guide GKE](Cyclos_GKE.md) si vous avez besoin de l'autre.

Si Cyclos n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de
travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré
dans les 30 jours pour une poignée de crédits, de sorte que les 76,75 $ US deviennent
quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **76,75 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **34 crédits par jour**, soit environ 1020 par mois (environ 102 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, moins sur un plan. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par
chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une
deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (chaud) | 19,72 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 76,75 $ US** |

### Comment cela se compare {#how-it-compares}

- Exécutez-le vous-même et un VPS exécutant Cyclos et PostgreSQL vous-même — une demande
  plus importante ici que pour la plupart des applications, étant donné la conformité et
  la disponibilité qu'une plateforme bancaire exige coûte moins cher en espèces : un
  Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go coûte environ 24 $ par mois, ou un GCP
  `e2-standard-2` environ 49 $ par mois — plus votre propre temps pour les sauvegardes, les
  correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret
  Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires —
  ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : les
  correctifs, les sauvegardes, les secrets et la surveillance, plus la possibilité de
  mettre Cyclos en pause gratuitement plutôt que de payer pour une capacité inactive (voir
  ci-dessous).
- La majeure partie du coût d'exécution ci-dessus est la base de données PostgreSQL gérée
  (et, le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison VPS
  nue doit exécuter et sauvegarder à la main.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Cyclos s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du
projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à
Cyclos dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en
continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à
  la suppression d'un module, cela ne détruit pas les ressources Cloud SQL ou Cloud Run
  une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le
  projet et de rattacher son compte de facturation, puis vous demande d'exécuter
  **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a
  été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
  facture jamais les frais de module à nouveau. C'est une poignée de crédits (moins de
  1 $ US) au total pour une chaîne Cyclos typique, contre les 115 crédits que coûte un
  redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 76,75 $
  US.** Déployez Cyclos, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois
  que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous
  avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les
  heures où il était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous
  apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans
  les 30 jours — après cela, Google le supprime définitivement. La restauration est
  admise comme la création d'un nouveau projet : votre solde de crédits achetés doit
  toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à
  la plupart des utilisations d'étude et de démo). Google indique que la plupart des
  services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est
  **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très
  probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même
  est récupérable pendant 30 jours. Si vous avez personnalisé Cyclos et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors
  du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run conserve une instance chaude, il ne se met donc pas entièrement à l'échelle à
zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans
votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 115 crédits (11,50 $ US) dans votre propre projet. La suppression ne permet
  d'économiser de l'argent que si Cyclos reste inutilisé pendant environ 5 jours ou plus,
  que ce soit dans votre propre projet ou dans un projet géré par RAD.
- **La majeure partie du coût d'exécution est généralement la base de données.** Elle ne
  s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Cyclos
  alors que quelque chose d'autre partage le projet n'économise que la partie calcul de
  cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
  dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous
  saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  suspendue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent
  ceux du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais propres à RAD et estimations de crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de
vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Cyclos s'exécute comme un conteneur Java/Tomcat sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Java/Tomcat, 1 vCPU / 2 GiB par défaut (à augmenter pour la production), autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Cyclos ne prend pas en charge MySQL ou SQL Server |
| Stockage d'objets | Cloud Storage | Un bucket de stockage de fichiers dédié (`<prefix>-cyclos-storage`) pour les fichiers et médias téléchargés |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré ; `ROOT_PASSWORD` pour la configuration de l'extension superutilisateur |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Cyclos nécessite six extensions PostgreSQL
  spécifiques (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`). MySQL et
  SQL Server ne sont pas pris en charge.
- **Les extensions PostgreSQL sont installées automatiquement** par le job `db-init` avant
  le démarrage de Cyclos — vous n'avez pas besoin de les activer manuellement.
- **Le stockage de fichiers GCS est obligatoire.** Cyclos utilise Google Cloud Storage
  comme gestionnaire de contenu de fichiers (`cyclos.storedFileContentManager = gcs`). Le nom du bucket est injecté
  automatiquement.
- **`enable_cloudsql_volume` est par défaut `false`.** Cyclos se connecte à Cloud SQL via
  TCP direct à l'IP privée, et non via le socket Unix du proxy d'authentification.
- **`max_instance_count` est par défaut 1.** Cyclos Community Edition nécessite une configuration
  Hazelcast pour la mise à l'échelle horizontale. N'augmentez qu'après avoir configuré le
  clustering.
- **Sonde de démarrage TCP.** La sonde de démarrage utilise TCP sur le port 8080 — et non
  HTTP — car Cyclos maintient le verrou de la base de données pendant sa phase
  d'initialisation Spring/schéma. Une sonde HTTP sur `/api` ne passerait pas tant que
  Cyclos ne serait pas entièrement initialisé, ce qui, lors d'une mise à jour continue,
  provoquerait un blocage avec l'instance précédente. TCP réussit dès que Tomcat écoute,
  permettant au trafic de se déplacer et à l'ancienne instance de libérer le verrou.
- **Gestion du schéma au démarrage.** Cyclos crée et fait évoluer son propre schéma
  PostgreSQL au premier démarrage. Le démarrage du premier déploiement prend 2 à 5
  minutes.
- **Les sondes de santé ciblent `/api`.** La sonde de vivacité cible `/api`, qui
  renvoie HTTP 200 uniquement une fois que Cyclos est entièrement initialisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services
et des ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Cyclos {#a-cloud-run--the-cyclos-service}

Cyclos s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction
de la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions
pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cyclos stocke toutes les données de l'application (comptes, transactions, membres) dans
une instance Cloud SQL gérée pour PostgreSQL 15. Le service se connecte via TCP direct à
l'IP privée de Cloud SQL. Lors du premier déploiement, un job d'initialisation (exécuté
en tant que job Cloud Run) crée la base de données de l'application, l'utilisateur et les
six extensions requises.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
  # Inside psql — confirm required extensions are installed:
  # \dx
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — gestionnaire de contenu de fichiers {#c-cloud-storage--file-content-manager}

Cyclos stocke tous les fichiers téléchargés, les photos de profil et les pièces jointes
aux transactions dans un bucket Cloud Storage dédié provisionné dans le cadre du
déploiement. Le nom du bucket est injecté automatiquement en tant que `cyclos.storedFileContentManager.bucketName`. Le compte
de service est automatiquement autorisé.

- **Console :** Cloud Storage → Buckets → recherchez `<prefix>-cyclos-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos-storage"
  gcloud storage ls gs://<cyclos-storage-bucket>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données Cyclos et le superutilisateur PostgreSQL
(`ROOT_PASSWORD`) sont stockés dans Secret Manager et injectés dans le service au moment de
l'exécution. Le job `db-init` utilise `ROOT_PASSWORD` pour installer les extensions ; Cyclos
utilise `DB_PASSWORD` pour se connecter au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ;
les paramètres d'ingress et le contrôle d'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des
politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cyclos {#3-cyclos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` s'exécute
  en tant que superutilisateur PostgreSQL et de manière idempotente : il crée
  l'utilisateur de base de données `cyclos`, crée la base de données de l'application,
  installe les six extensions requises (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`,
  `postgis`, `unaccent`) et accorde les privilèges nécessaires. Il peut être réexécuté en
  toute sécurité.

  Inspectez le job et ses exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Gestion du schéma au démarrage.** Cyclos crée et fait évoluer son propre schéma
  PostgreSQL au démarrage (`cyclos.db.managed = true`). Le démarrage du premier déploiement prend 2 à 5
  minutes.
- **Sonde de démarrage TCP.** Lors d'une mise à jour continue, la nouvelle instance doit
  acquérir le verrou d'initialisation de la base de données Cyclos avant que l'ancienne
  instance ne le libère. Une sonde HTTP sur `/api` ne passerait jamais tant que Cyclos
  ne serait pas entièrement initialisé, provoquant un blocage. La sonde de démarrage TCP
  réussit dès que Tomcat écoute (~32 secondes), permet le transfert de trafic vers la
  nouvelle révision, ce qui envoie SIGTERM à l'ancienne instance et libère le verrou. La
  sonde de vivacité détecte ensuite tout contexte Spring non initialisé et déclenche un
  redémarrage propre.
- **Dimensionnement du tas JVM.** Définissez la variable d'environnement `CYCLOS_OPTIONS` pour
  limiter le tas JVM — par exemple `{ CYCLOS_OPTIONS = "-Xmx2g" }` pour une limite de mémoire de 4 GiB. Sans
  cela, la JVM peut consommer toute la mémoire disponible du conteneur et être OOMKilled.
- **Par défaut, instance unique.** Cyclos Community Edition est par défaut une instance
  unique (`max_instance_count = 1`). L'augmentation sans configuration de clustering Hazelcast entraîne un
  traitement des transactions non atomique et une corruption potentielle des données.
- **Envoi d'e-mails.** Cyclos envoie des e-mails transactionnels via SMTP. Le module
  pré-remplit les valeurs de remplacement SMTP dans `environment_variables` — mettez-les à jour avant de
  passer en production :
  ```bash
  environment_variables = {
    SMTP_HOST  = "smtp.sendgrid.net"
    SMTP_PORT  = "587"
    SMTP_USER  = "apikey"
    SMTP_SSL   = "true"
    EMAIL_FROM = "noreply@yourbank.example.com"
  }
  ```
  Utilisez `secret_environment_variables` pour `SMTP_PASSWORD`.
- **Connexion directe à la base de données via TCP.** `DB_HOST` est défini sur l'adresse IP
  privée de Cloud SQL (pas un chemin de socket). Assurez-vous que l'accès aux services
  privés est configuré sur le VPC afin que le service Cloud Run puisse atteindre
  l'instance Cloud SQL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Cyclos sont listés ;
chaque autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

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
| `application_name` | `cyclos` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `display_name` | `Cyclos Community Edition` | Nom convivial affiché dans la console et les tableaux de bord de surveillance. |
| `description` | `Cyclos Banking System on Cloud Run` | Description du service. |
| `application_version` | `4.16.17` | Tag de version de l'image Cyclos. Incrémenter pour déclencher une nouvelle révision. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. **Augmenter à `2000m` pour la production.** |
| `memory_limit` | `2Gi` | Mémoire par instance. **Augmenter à `4Gi` pour la production.** |
| `min_instance_count` | `1` | Instances minimales. Garder ≥ 1 pour éviter les démarrages à froid lents de la JVM. |
| `max_instance_count` | `1` | Instances maximales. Garder `1` sauf si le clustering Hazelcast est configuré. |
| `container_port` | `8080` | Cyclos/Tomcat écoute sur le port 8080. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run. Gen2 requise pour l'égression VPC vers l'IP privée Cloud SQL. |
| `enable_cloudsql_volume` | `false` | Cyclos utilise TCP vers l'IP privée Cloud SQL par défaut ; activer uniquement si le proxy d'authentification est utilisé. |
| `traffic_split` | `[]` | Allocation de trafic Canary/bleu-vert entre les révisions. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Carte de remplacement SMTP | Pré-rempli avec les valeurs par défaut SMTP — à configurer avant de passer en production. Les variables Cyclos principales sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Carte de var d'env → nom de secret Secret Manager. Utiliser pour `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définir `false` après une importation réussie. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et cycle de vie des images {#group-10--load-balancer-cdn--image-lifecycle}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données supplémentaire. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires (le bucket `cyclos-storage` principal est provisionné automatiquement). |
| `enable_nfs` | `false` | NFS n'est pas utilisé par le conteneur Cyclos (GCS est le magasin de fichiers). |
| `gcs_volumes` | `[]` | Montages GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `cyclos` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `cyclos` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (crée les extensions, l'utilisateur et la base de données). |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, port 8080, délai de 60s, période de 20s, 15 échecs | La sonde TCP évite le blocage du verrou de la base de données lors de la mise à jour continue. |
| `liveness_probe` | HTTP `/api`, délai de 120s, période de 30s, 3 échecs | La sonde HTTP détecte le contexte Spring non initialisé après le démarrage. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Vérification de la disponibilité de Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
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
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (codé en dur via Cyclos_Common) | Critique | Cyclos nécessite PostgreSQL avec six extensions. MySQL ou `NONE` interrompt complètement le démarrage. |
| `db_name` / `db_user` | défini une fois (`cyclos` / `cyclos`) | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données financières. |
| `max_instance_count` | `1` (par défaut) | Critique | Plus de 1 sans clustering Hazelcast entraîne des transactions non atomiques et une corruption potentielle des données. |
| `application_name` | `cyclos` (ne pas modifier) | Critique | Intégré dans le nom du service Cloud Run, le dépôt Artifact Registry, les secrets Secret Manager et le nom du bucket GCS. La modification orpheline toutes les ressources. |
| `application_version` | tag épinglé (par ex. `4.16.17`) | Critique | Les migrations de schéma Cyclos sont unidirectionnelles ; le déploiement d'une version plus récente sans chemin de migration testé corrompt le schéma. |
| var d'env `cyclos.storedFileContentManager` | `gcs` (codé en dur) | Critique | La surcharge vers `local` écrit les fichiers dans le stockage de conteneur éphémère ; tous les téléchargements sont perdus au redémarrage. |
| `memory_limit` | `≥ 2Gi` (`4Gi` recommandé) | Critique | La JVM lève `OutOfMemoryError` ; le conteneur est OOMKilled (code de sortie 137). |
| var d'env `CYCLOS_OPTIONS` | `-Xmx2g` pour une limite de 4 GiB | Critique | Pas de limite de tas JVM : Cyclos consomme toute la mémoire du conteneur ; OOMKilled sous charge. |
| `startup_probe.type` | `TCP` (par défaut) | Élevé | La sonde HTTP sur `/api` lors d'une mise à jour continue provoque un blocage du verrou de la base de données ; la nouvelle révision ne devient jamais saine. |
| `startup_probe.path` (vivacité) | `/api` | Critique | Mauvais chemin : la sonde ne voit jamais HTTP 200 ; Cloud Run tue la révision. |
| `enable_cloudsql_volume` | `false` (par défaut) | Élevé | Si l'accès aux services privés n'est pas configuré, la connexion TCP directe à l'IP privée de Cloud SQL échoue ; l'initialisation de la base de données et le démarrage de l'application échouent tous deux. |
| `min_instance_count` | `1` | Élevé | `0` (mise à l'échelle à zéro) ajoute des démarrages à froid JVM de 45 à 120 s ; les transactions bancaires expirent. |
| `execution_environment` | `gen2` | Élevé | Gen1 peut avoir des problèmes de routage avec l'IP privée Cloud SQL via VPC. Toujours utiliser gen2 pour Cyclos. |
| `enable_backup_import` | `false` après restauration | Élevé | Laisser `true` réexécute la restauration à chaque apply, écrasant les données financières en direct. |
| `SMTP_HOST` / `EMAIL_FROM` | serveur réel / adresse réelle | Élevé | Les valeurs par défaut des espaces réservés ne livrent aucun e-mail ; les réinitialisations de mot de passe et les notifications de transaction sont silencieusement supprimées. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface d'administration de Cyclos est autrement accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des enregistrements financiers. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Cyclos
partagée avec la variante GKE est décrite dans **[Cyclos_Common](Cyclos_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Cyclos sur Cloud Run](../labs/Cyclos_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cyclos sur GKE Autopilot](Cyclos_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Cyclos Common — Configuration d'application partagée](Cyclos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [EspoCRM sur Google Cloud Run](EspoCRM_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) dans la solution **Inclusion financière et services bancaires communautaires**.
