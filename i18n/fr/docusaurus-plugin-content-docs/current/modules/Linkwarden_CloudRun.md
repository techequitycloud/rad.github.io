---
title: "Linkwarden sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Linkwarden sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Linkwarden_CloudRun.md @ e69407af sha256:0916d6894a32 -->

# Linkwarden sur Google Cloud Run {#linkwarden-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Linkwarden_CloudRun.png" alt="Linkwarden sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Linkwarden est un gestionnaire de signets open source auto-hébergé qui va au-delà
de la simple sauvegarde de liens : chaque signet peut être automatiquement archivé
sous forme de capture d'écran pleine page, de PDF et d'instantané "monolithe"
en un seul fichier à l'aide d'un Chrome sans tête intégré, de sorte que vos
liens continuent de fonctionner même après que la page source change ou
disparaisse. Ce module déploie Linkwarden sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Linkwarden utilise et sur la
façon de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, entrée et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte Linkwarden sur RAD, et comment cela se compare {#what-linkwarden-costs-on-rad-and-how-that-compares}

**Linkwarden sur le module Cloud Run de RAD coûte environ 157 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 110 crédits (11,00 $ US).** Linkwarden lui-même est gratuit et open source (AGPL), il s'agit donc du coût d'infrastructure de l'exécution de votre propre archive, sans frais par utilisateur et sans limite de liens. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 157 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **157 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **72 crédits par jour**, soit environ 2160 par mois (environ 216 $ US au prix de la recharge, 173 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque
application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 Gio (alwaysOn) | 99,90 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 157 $ US** |

### Comment cela se compare {#how-it-compares}

- **Le propre projet de Linkwarden vend Linkwarden Cloud hébergé** sur [linkwarden.app/pricing](https://linkwarden.app/pricing) : un plan unique à 3 $/utilisateur/mois (2,25 $/utilisateur/mois facturé annuellement), jusqu'à 30 000 liens par utilisateur, avec un essai gratuit de 14 jours.
- **Pour une petite équipe, Linkwarden Cloud est clairement moins cher en espèces que les 157 $ US de RAD** — cinq utilisateurs coûtent environ 15 $/mois mensuellement ou 11,25 $/mois annuellement. L'auto-hébergement sur RAD devient rentable une fois qu'une équipe est suffisamment grande, ou valorise le fait de conserver l'archive (et le rendu d'instantanés Chrome sans tête) entièrement dans son propre projet plutôt que celui d'un tiers, ou ne veut pas de limite par lien.
- Un VPS nu (Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go, environ 24 $/mois) est encore moins cher en espèces, avec le compromis habituel de l'exécution de Postgres, de l'archiveur Chrome sans tête, des sauvegardes et des correctifs par vous-même.
- Voir le [guide GKE](Linkwarden_GKE.md) si vous préférez l'exécuter avec d'autres charges de travail Kubernetes.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Linkwarden s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième option
qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le
dans les 30 jours pour presque rien.** Cela convient bien mieux à Linkwarden dont vous n'avez
besoin qu'occasionnellement — un projet de cours, une démo, une évaluation de courte durée —
que de l'exécuter en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
  demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne
  détruit pas Cloud SQL ou le calcul propre de Linkwarden un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et
  rattache son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette
  mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture plus les frais de module. Pour Linkwarden
  derrière un petit Services_GCP et Project_GCP, cela représente **une poignée de crédits
  (moins de 1 $ US)** au total, contre les 115 crédits que coûte un
  redéploiement complet.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que RAD gère uniquement
  pour la facturation), et vous le restaurez vous-même dans les 30 jours — après
  cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des études et des démos utilisent). Google indique que la plupart des
  services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de Linkwarden
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Linkwarden et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable
  dedans, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

La configuration par défaut de ce module maintient Cloud Run en fonctionnement continu (CPU toujours alloué), il ne se met donc pas à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  115 crédits (11,50 $ US), car RAD
  recrée le projet et les services partagés avant Linkwarden. La suppression permet d'économiser de l'argent
  seulement si Linkwarden resterait inutilisé pendant environ trois jours
  ou plus, à la fois dans votre propre projet (environ 5,23 $ US par jour) et dans
  un projet géré par RAD (72 crédits par jour).
- **Supprimez tout ce que Linkwarden utilise.** La majeure partie du coût d'exécution est généralement la base de données. Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Linkwarden alors que quelque chose d'autre partage le projet n'économise que la partie calcul propre de Linkwarden.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Linkwarden pour une classe. Chaque
  participant obtient Linkwarden dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Linkwarden pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin de l'engagement, le partenaire transfère le projet,
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et l'estimation quotidienne de 72 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle. [Prix de Linkwarden Cloud](https://linkwarden.app/pricing). Les prix changent ;
vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Linkwarden s'exécute comme un conteneur Node.js/Next.js unique sur Cloud Run v2. Le serveur web et un processus d'archivage en arrière-plan s'exécutent côte à côte dans le MÊME conteneur (via `concurrently`) — il n'y a pas de service de travailleur séparé. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Next.js + Chrome sans tête, 2 vCPU / 2 Gio par défaut, `min_instance_count = 1` (le travailleur en arrière-plan doit continuer à s'exécuter) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le schéma Prisma de Linkwarden est uniquement Postgres |
| Stockage d'objets | Cloud Storage (volume GCS Fuse) | Monté à `/data/data` par défaut pour les captures d'écran/PDF/monolithes archivés |
| Cache et file d'attente | Aucun | Le travailleur d'archivage interroge directement PostgreSQL ; aucune dépendance Redis/BullMQ |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` auto-généré ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le schéma Prisma de Linkwarden code en dur le
  fournisseur `postgresql` ; la sélection de tout autre moteur interrompt la migration
  au premier démarrage.
- **`DATABASE_URL` se connecte via l'IP privée, pas le socket.** Un chemin de répertoire de socket Unix Cloud SQL contient des deux-points qui rompent l'analyse DSN de l'autorité d'URL de Prisma, de sorte que le point d'entrée cloud utilise toujours l'IP privée Cloud SQL injectée `DB_IP` (la vraie) avec `sslmode=require`.
- **`NEXTAUTH_URL` est dérivé automatiquement**, en ajoutant le suffixe requis
  `/api/v1/auth` à l'URL de service Cloud Run calculée — ne le définissez jamais
  manuellement avec un modèle littéral `$(VAR)` (Cloud Run le transmet
  non développé).
- **`min_instance_count = 1` et `cpu_always_allocated = true` par défaut.**
  Le travailleur d'archivage en arrière-plan intégré au conteneur doit continuer à traiter la
  file d'attente entre les requêtes ; la mise à l'échelle à zéro arrêterait l'archivage.
- **Chrome sans tête s'exécute en processus avec le serveur web.** Contrairement à Crawl4AI (un
  service supervisord séparé), l'archivage de captures d'écran/PDF/monolithes de Linkwarden
  partage le même conteneur/processus que le serveur Next.js — dimensionnez
  `memory_limit`/`cpu_limit` pour le pic de l'ensemble du conteneur, pas seulement le
  serveur web. Par défaut : 2 vCPU / 2 Gio ; augmentez la mémoire à 4 Gio pour les charges d'archivage lourdes.
- **Un volume GCS est monté automatiquement à `/data/data`.** C'est le
  chemin absolu que le code de stockage de Linkwarden résout `STORAGE_FOLDER` en
  (vérifié par rapport à l'image construite), de sorte que le contenu archivé persiste après
  les redémarrages sans nécessiter de NFS (`enable_nfs = false` par défaut).
- **Pas de superutilisateur pré-initialisé.** Le premier utilisateur à s'inscrire via le flux
  d'inscription NextAuth standard devient le propriétaire de l'instance.
- **`DISABLE_BROWSER` est un mécanisme de secours documenté**, pas une valeur par défaut. Si le
  bac à sable gVisor de Cloud Run a du mal à lancer le Chrome sans tête intégré (une
  classe de risque similaire à l'incompatibilité documentée Prowlarr s6-overlay/gVisor
  ailleurs dans ce catalogue), définissez `disable_browser = true`
  pour ignorer toutes les tâches d'archivage dépendantes du navigateur tout en conservant les
  fonctionnalités de métadonnées/balises/collections de liens. Vérifiez en direct avant de supposer que cela
  est nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Linkwarden {#a-cloud-run--the-linkwarden-service}

Linkwarden s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Linkwarden stocke toutes les données de l'application (signets, collections, balises, utilisateurs, métadonnées d'archive) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le point d'entrée cloud se connecte directement via l'IP privée de Cloud SQL (`DB_IP`), et non le socket Unix du proxy d'authentification — une exigence spécifique à Prisma, car un chemin de répertoire de socket rompt l'analyse DSN de l'autorité d'URL. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application ; Linkwarden exécute ensuite son propre `prisma migrate deploy` à chaque démarrage de conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage (contenu archivé) {#c-cloud-storage-archived-content}

Un bucket **Cloud Storage** dédié est provisionné automatiquement et monté
via GCS Fuse à `/data/data` par défaut — le chemin absolu que le code de
stockage de Linkwarden résout `STORAGE_FOLDER` en à l'exécution. Les processus
web et worker résolvent tous deux ce même chemin malgré l'exécution à partir de
répertoires de travail différents à l'intérieur du conteneur.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :
`NEXTAUTH_SECRET` (signe les JWT de session NextAuth). Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et le contrôle d'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneur sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Linkwarden {#3-linkwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh`
  à l'aide de `postgres:15-alpine`. Il se connecte via l'IP privée de Cloud SQL
  et crée de manière idempotente la base de données et l'utilisateur de l'application et accorde
  les privilèges. Le job peut être réexécuté en toute sécurité.
- **Les migrations de schéma s'exécutent à chaque démarrage.** L'image de base de Linkwarden `CMD` exécute
  `prisma migrate deploy` avant de démarrer les processus web et worker, de sorte que
  la mise à niveau de la version de l'application applique automatiquement les modifications de schéma —
  il n'y a pas de job de migration séparé.
- **`NEXTAUTH_SECRET` est immuable après le premier démarrage.** Généré une fois et
  écrit dans Secret Manager. Le faire pivoter invalide toutes les sessions actives,
  obligeant tous les utilisateurs à se reconnecter.
- **Pas de compte administrateur pré-initialisé.** Le premier utilisateur à s'inscrire via le
  flux d'inscription NextAuth standard devient le propriétaire de l'instance — il n'y a
  pas de créance par défaut à récupérer.
- **Travailleur d'archivage en arrière-plan.** Un processus séparé (`worker.ts`, exécuté via
  `concurrently` à côté du serveur web dans le même conteneur) interroge
  directement PostgreSQL et traite les liens en file d'attente par lots
  (`ARCHIVE_TAKE_COUNT`, par défaut `5`). Chaque lot lance des instances Chrome sans tête
  pour la capture de captures d'écran/PDF/monolithes — le CPU/la mémoire augmentent brièvement
  pendant chaque lot.
- **Chemin de santé.** Les sondes de démarrage et de vivacité par défaut sont `/` — Linkwarden n'a
  pas de point de terminaison de santé dédié confirmé. La sonde de démarrage autorise une fenêtre généreuse
  (délai initial de 60 s, seuil de 30 échecs) pour absorber le démarrage à froid de Next.js
  plus l'initialisation de Chrome sans tête/Playwright.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Linkwarden sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 / 2 — Projet et identité {#group-1--2--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `linkwarden` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Linkwarden` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Linkwarden publie une véritable balise `latest` en amont — cela épingle/suit la version réelle en amont, contrairement à d'autres modules de build personnalisés. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | 2 vCPU — l'archivage Chrome sans tête s'exécute en processus avec le serveur web. |
| `memory_limit` | `2Gi` | Minimum pour Chromium sans tête intégré ; augmentez à `4Gi` pour les charges de travail PDF/capture d'écran lourdes. |
| `cpu_always_allocated` | `true` | Maintient le travailleur d'archivage en arrière-plan en cours de traitement entre les requêtes. |
| `min_instance_count` | `1` | Maintient le travailleur d'archivage en vie ; la mise à l'échelle à zéro arrêterait l'archivage en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `container_port` | `3000` | Linkwarden (Next.js) écoute sur le port 3000. |
| `execution_environment` | `gen2` | Requis pour les montages GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Conservé pour la parité ; le point d'entrée se connecte directement via `DB_IP`, pas le socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Linkwarden dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

Standard `ingress_settings`, `vpc_egress_setting`, `enable_iap` — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DATABASE_URL`, `NEXTAUTH_URL`, `PORT` et `HOSTNAME` sont définis automatiquement — ne les définissez pas ici. |
| `disable_browser` | `false` | Définit `DISABLE_BROWSER` — ignore toutes les tâches d'archivage Chrome sans tête. Solution de secours si le bac à sable de Cloud Run se comporte mal avec Chrome. |
| `archive_take_count` | `5` | Liens traités par lot de travailleur en arrière-plan (`ARCHIVE_TAKE_COUNT`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — Linkwarden utilise un volume GCS à la place pour plus de simplicité. |
| `gcs_volumes` | `[]` (revient à une valeur par défaut intégrée) | Un volume "storage" par défaut monté à `/data/data` est automatiquement câblé, sauf si vous fournissez votre propre liste, qui le remplace entièrement. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — le schéma Prisma de Linkwarden est uniquement Postgres. |
| `db_name` | `linkwarden` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `linkwarden` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Linkwarden exécute ses propres migrations Prisma au démarrage — aucun job de migration séparé n'est nécessaire. |
| `cron_jobs` | `[]` | Non utilisé par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Linkwarden n'a pas de point de terminaison de santé dédié confirmé ; fenêtre de temps généreuse pour le démarrage à froid + l'initialisation de Chrome. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Linkwarden — son travailleur d'archivage interroge directement PostgreSQL. Conservé pour la parité des variables de la Fondation. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. La plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives, obligeant tous les utilisateurs à se reconnecter. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` (fixe) | Critique | Tout autre moteur interrompt entièrement la migration Prisma au premier démarrage. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro arrête le travailleur d'archivage en arrière-plan entre les requêtes — les liens en file d'attente ne sont jamais archivés. |
| `memory_limit` | `2Gi` minimum | Élevé | L'archivage Chrome sans tête subit des OOM en dessous de ce seuil ; le serveur web peut toujours répondre tandis que l'archivage échoue silencieusement. |
| `enable_nfs` + `gcs_volumes` | Laissez `enable_nfs=false`, utilisez le volume GCS par défaut | Moyen | L'activation de NFS sans désactiver également le câblage du volume GCS par défaut peut laisser le contenu archivé réparti sur deux backends de stockage. |
| `disable_browser` | `false` sauf si Chrome échoue sur le bac à sable de Cloud Run | Moyen | Le laisser `true` désactive inutilement tout l'archivage de captures d'écran/PDF/monolithes — Linkwarden devient une simple liste de liens. |
| `archive_take_count` | `5` (par défaut) | Faible | Les grandes valeurs augmentent fortement le CPU/la mémoire pendant chaque lot (instances Chrome sans tête concurrentes). |
| `ingress_settings` | `all` pour une utilisation normale | Moyen | La restriction à `internal` bloque le flux de connexion/inscription public nécessaire pour le compte propriétaire au premier démarrage. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Linkwarden
partagée avec la variante GKE est décrite dans
**[Linkwarden_Common](Linkwarden_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Linkwarden sur Cloud Run](../labs/Linkwarden_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Linkwarden sur GKE Autopilot](Linkwarden_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Linkwarden Common — Configuration d'application partagée](Linkwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Memos sur Google Cloud Run](Memos_CloudRun.md), [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Connaissances personnelles et lecture**.
