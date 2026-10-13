---
title: "AnythingLLM sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'AnythingLLM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/AnythingLLM_CloudRun.md @ e69407af sha256:481dd2e822a5 -->

# AnythingLLM sur Google Cloud Run {#anythingllm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AnythingLLM_CloudRun.png" alt="AnythingLLM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

AnythingLLM est un espace de travail d'IA privé et une plateforme de génération augmentée
par récupération (RAG) qui permet aux équipes de discuter avec des documents, de se
connecter à n'importe quel fournisseur de LLM (OpenAI, Anthropic, Ollama et autres) et de
créer des assistants de connaissances basés sur l'IA — sans envoyer de données à des
services tiers. Ce module déploie AnythingLLM sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par AnythingLLM et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application Cloud Run — identité de service,
ingestion et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte AnythingLLM sur RAD, et comment cela se compare {#what-anythingllm-costs-on-rad-and-how-that-compares}

**AnythingLLM sur le module Cloud Run de RAD coûte environ 102 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 110 crédits (11 $ US au prix de la recharge) dans un projet que vous possédez, et 99 crédits (10 % de moins) dans un projet géré par RAD. Si AnythingLLM doit fonctionner en continu sur plusieurs pods ou à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](AnythingLLM_GKE.md). Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 102 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 102 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 $ US au prix de la recharge, 77 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données et le serveur de fichiers/cache sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'en ajoute pas une deuxième.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 Gio (scaleToZero) | 31,53 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 102 $ US** |

### Comment cela se compare {#how-it-compares}

- L'offre Cloud hébergée d'AnythingLLM — le même logiciel, géré par son créateur — coûte **50 $/mois** (Basic, une instance privée) ou **99 $/mois** (Pro, ressources prioritaires et un SLA de support). RAD exécute la même application open source sur une infrastructure que vous ou RAD contrôlez, plutôt que sur un hébergement partagé par un tiers.
- **RAD exécute le projet open source lui-même, et non un hébergement fourni par un fournisseur.** Vous obtenez le même logiciel, sous votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par utilisateur ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** L'exécution du même logiciel open source par vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près de la même forme ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois. RAD n'est pas moins cher en termes d'argent — la différence est la base de données gérée, Secret Manager et la surveillance qui viennent avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si AnythingLLM s'exécute dans **un projet géré par RAD pour vous**, vous disposez d'une
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du
projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à
une utilisation occasionnelle — étudier pour une certification, une démo, un besoin
saisonnier — que l'exécution continue d'AnythingLLM.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet purement et simplement. Google
  ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30
  jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
  attend. Contrairement à la suppression d'un seul module, cela ne détruit pas la base de
  données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet
  s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30
  jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de
  réactiver le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise
  à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de
  crédits au total (moins de 1 $ US), contre le paiement des frais de module et une
  reconstruction complète.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont
  RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours —
  après quoi Google le supprime définitivement — et la restauration est admise comme la
  création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours
  dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des
  utilisations d'étude et de démo conviennent). Google indique que la plupart des
  services sont entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'AnythingLLM
  écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu
  dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30
  jours — ce bucket a la suppression logicielle de Cloud Storage explicitement
  désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail
  doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant
  de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a
  pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de secours pour un projet que vous possédez, ou une fois que la fenêtre
de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et
redéployez-le lorsque vous en aurez de nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds :
  environ 115 crédits (environ 11,50 $ US) dans votre propre projet, ou 104 crédits dans
  un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La
  suppression permet d'économiser de l'argent une fois qu'AnythingLLM resterait
  inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son
  propre coût d'exécution — environ 3 jours ou plus dans votre propre projet (3,40 $
  US/jour) ou 3 jours ou plus dans un projet géré par RAD (32 crédits/jour).
- **La majeure partie du coût d'exécution est généralement une infrastructure partagée.**
  La base de données et la VM de fichier ou de cache ne s'arrêtent que lorsque rien
  d'autre dans le projet ne les utilise, de sorte que la suppression d'AnythingLLM
  lorsqu'une autre application partage le projet n'économise que la partie de calcul
  d'AnythingLLM.
- **Conservez vos données en premier.** Tout ce qu'AnythingLLM écrit dans un bucket de
  sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière
  sauvegarde (vers Google Drive ou un bucket que vous conservez) avant de la supprimer si
  vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les
  paramètres lorsque vous redéployez.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant reçoit AnythingLLM dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits non utilisés sont restitués au
  formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  AnythingLLM pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  suspendue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent
  ceux du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification AnythingLLM Cloud](https://anythingllm.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

AnythingLLM s'exécute en tant que conteneur Node.js AI sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 Gio par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — AnythingLLM utilise Prisma ORM et ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Bucket de documents `anythingllm-docs` auto-provisionné ; buckets supplémentaires facultatifs |
| Fichiers partagés | Filestore (NFS) | Facultatif — pour le stockage persistant de documents/vecteurs multi-instances ; nécessite la génération 2 |
| Secrets | Secret Manager | Quatre secrets d'application auto-générés (`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`) plus le mot de passe de la base de données |
| Ingestion | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS global facultatif + Cloud Armor + domaine personnalisé |
| Cache | Redis | Désactivé par défaut ; facultatif pour les charges de travail de session ou de cache |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma d'AnythingLLM nécessite PostgreSQL. Ne
  définissez pas `database_type` sur une variante MySQL ou SQL Server.
- **Quatre secrets d'application sont auto-générés.** `JWT_SECRET`, `AUTH_TOKEN`,
  `SIG_KEY` et `SIG_SALT` sont créés dans Secret Manager lors du premier
  déploiement ; vous ne les définissez jamais en texte clair.
- **`min_instance_count` est par défaut `0`** (mise à l'échelle à zéro). NFS
  garde le LanceDB vector store en sécurité lors des démarrages à froid, donc le
  compromis est seulement un démarrage à froid d'environ 30 à 60 secondes sur la première
  requête après l'inactivité ; définissez `min_instance_count = 1` pour l'éviter pour les
  déploiements sensibles à la latence.
- **Le stockage doit être persistant, et NFS est activé par défaut.** Tous les documents
  de l'espace de travail, les index vectoriels et les données de conversation sont écrits
  sous `STORAGE_DIR`. `enable_nfs` est par défaut `true` car
  l'index vectoriel LanceDB d'AnythingLLM résiderait autrement sur le disque éphémère du
  conteneur et serait silencieusement effacé à chaque démarrage à froid ou redéploiement.
- **Redis est désactivé par défaut.** Il n'est pas requis pour la fonctionnalité
  principale d'AnythingLLM. S'il est activé, `redis_host` doit être défini
  explicitement.
- **Facturation basée sur les requêtes par défaut.** `cpu_always_allocated = false` —
  l'intégration de documents se poursuit dans un processus d'arrière-plan après le retour
  de la requête de téléchargement, et il a été mesuré qu'elle se termine sur une instance
  ralentie et inactive pour un petit document. Pour une ingestion volumineuse ou continue,
  envisagez `cpu_always_allocated = true`.
- **`execution_environment = gen2`** est la valeur par défaut et est requise lorsque les montages
  NFS ou GCS Fuse sont activés.
- **La variable d'environnement `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` est définie automatiquement** à
  partir du bucket GCS `anythingllm-docs` provisionné.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service AnythingLLM {#a-cloud-run--the-anythingllm-service}

AnythingLLM s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en
fonction de la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions
pour des déploiements sécurisés. Les opérations d'intégration et d'inférence d'IA
nécessitent au moins 2 vCPU et 4 Gio de RAM ; le démarrage rapide du CPU est activé.

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

AnythingLLM stocke toutes les métadonnées de l'espace de travail, les comptes
utilisateurs et l'historique des conversations dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur
un socket Unix (pas d'IP publique). Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application. La chaîne de
connexion Prisma `DATABASE_URL` est assemblée par le script d'entrée d'AnythingLLM à
partir des variables d'environnement `DB_*` injectées par la fondation au
moment du démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — bucket de documents {#c-cloud-storage--document-bucket}

`AnythingLLM_Common` provisionne automatiquement un bucket **Cloud Storage** dédié
(`anythingllm-docs`) pour le stockage de documents et de vecteurs. Le compte de service
de la charge de travail se voit accorder un accès automatique et le nom du bucket est
injecté en tant que `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Des buckets supplémentaires peuvent être
déclarés dans `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<docs-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et les options CMEK.

### D. Filestore (NFS) — stockage partagé facultatif {#d-filestore-nfs--optional-shared-storage}

Pour les déploiements multi-instances où toutes les instances doivent accéder aux mêmes
documents et index vectoriels, activez **Filestore (NFS)**. NFS est désactivé par défaut
et nécessite `execution_environment = gen2`.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage NFS et CMEK.

### E. Secret Manager {#e-secret-manager}

Quatre secrets d'application AnythingLLM sont auto-générés et stockés dans Secret
Manager — `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY` et `SIG_SALT` — plus le
mot de passe de la base de données. Aucun de ceux-ci n'apparaît en texte clair nulle part
dans le déploiement.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingestion {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS global avec Cloud Armor, un domaine personnalisé et Cloud CDN peuvent être
superposés. `ingress_settings` et `vpc_egress_setting` contrôlent quelles sources de trafic
peuvent atteindre le service et comment le trafic sortant est acheminé via le VPC.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont acheminées vers Cloud Monitoring. Une vérification de disponibilité
facultative (désactivée par défaut, ciblant `/`) et des politiques
d'alerte peuvent être activées.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application AnythingLLM {#3-anythingllm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) utilise l'image `postgres:15-alpine` pour créer la
  base de données et l'utilisateur AnythingLLM avant le démarrage du service. Il est
  idempotent et peut être réexécuté en toute sécurité.
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Migrations Prisma au démarrage.** Le script d'entrée construit la chaîne de connexion
  `DATABASE_URL` à partir des variables d'environnement `DB_*` injectées par
  la plateforme et exécute les migrations Prisma, de sorte que les mises à niveau de
  version appliquent automatiquement les modifications de schéma.
- **Chargement du modèle d'IA.** AnythingLLM charge les modèles d'intégration en mémoire
  au premier démarrage. La sonde de démarrage utilise un délai initial de 60 secondes et
  30 périodes d'échec (×10 secondes = 5 minutes au total) pour s'adapter à cela.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/ping`
  en utilisant HTTP, qui renvoie HTTP 200 uniquement lorsque l'application est
  entièrement initialisée. Contrairement à Mautic/Apache, AnythingLLM ne redirige pas le
  trafic HTTP de santé, de sorte que les sondes HTTP fonctionnent sans ajustement sur
  Cloud Run.
- **Configuration du fournisseur LLM.** Utilisez `environment_variables` pour les paramètres
  de fournisseur non sensibles (`LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`) et
  `secret_environment_variables` pour mapper les noms de variables d'environnement aux secrets de
  Secret Manager pour les clés API (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.).
- **Cohérence du moteur d'intégration.** La modification de `EMBEDDING_ENGINE` après
  l'ingestion de documents rend les index vectoriels existants incompatibles. Tous les
  documents doivent être réintégrés après toute modification du moteur d'intégration.
- **Variables d'environnement fixes.** `SERVER_PORT=3001`, `UID=1000` et
  `GID=1000` sont définies automatiquement par `AnythingLLM_Common`. Ne les
  remplacez pas. `AnythingLLM_Common` définit également `STORAGE_DIR=/app/server/storage` comme sa
  propre valeur par défaut, mais `AnythingLLM_CloudRun` la remplace par le chemin de
  montage NFS (`nfs_mount_path`, par défaut `/app/server/storage`) chaque fois que
  `enable_nfs = true` — la valeur par défaut du module — de sorte que l'index
  vectoriel de la base de connaissances atterrit sur le partage NFS. Avec `enable_nfs = false`,
  il revient au disque éphémère du conteneur et est perdu à chaque démarrage à froid (voir
  Groupe 11).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour AnythingLLM sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `anythingllm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `AnythingLLM` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image ; épingler à un tag de version pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. Minimum 2 vCPU pour les charges de travail d'IA. |
| `memory_limit` | `4Gi` | Mémoire par instance. Minimum 4 Gio pour l'intégration et l'inférence. |
| `min_instance_count` | `0` | Instances minimales. Définir ≥ 1 pour éviter les démarrages à froid (NFS maintient le magasin de vecteurs en sécurité de toute façon). |
| `max_instance_count` | `1` | Instances maximales. Augmenter avec NFS pour l'accès aux documents partagés. |
| `container_port` | `3001` | Port HTTP natif d'AnythingLLM. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête. Augmenter pour l'ingestion de documents longs. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `traffic_split` | `[]` | Allocation de trafic entre les révisions pour les déploiements échelonnés. |

### Groupe 5 — Contrôle d'accès et d'ingestion {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. **Recommandé pour la production.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets, par exemple `LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager pour les clés API. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

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

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge (nécessite `enable_cloud_armor`). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données supplémentaire. Le bucket `anythingllm-docs` est toujours créé. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires. |
| `enable_nfs` | `true` | Filestore (NFS) pour le stockage persistant de documents/vecteurs — requis, sinon l'index vectoriel LanceDB réside sur un disque éphémère et est effacé à chaque démarrage à froid/redéploiement. |
| `nfs_mount_path` | `/app/server/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe pour AnythingLLM — ne pas modifier. |
| `application_database_name` | `anythingllmdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `anythingllmuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires facultatifs pour les détails de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires à côté d'AnythingLLM. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/ping`, délai initial de 60 s, 30 échecs | Fenêtre de démarrage étendue pour le chargement du modèle d'IA. |
| `liveness_probe` / `health_check_config` | HTTP `/api/ping`, délai initial de 30 s | Sonde de vivacité vers le point de terminaison de santé d'AnythingLLM. |
| `uptime_check_config` | désactivé, `/` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis pour la fonctionnalité principale d'AnythingLLM. Activer pour les charges de travail de cache facultatives. |
| `redis_host` | `null` | Point de terminaison Redis. **Requis** lorsque `enable_redis = true`. |
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
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `anythingllm-docs`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture
> sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des
> montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée,
> un `redis_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant la création
> de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en
> amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | AnythingLLM nécessite PostgreSQL ; tout autre moteur casse Prisma ORM et provoque un crash au démarrage. |
| Persistance `STORAGE_DIR` | NFS ou GCS Fuse | Critique | Sans volume persistant, tous les documents de l'espace de travail, les index vectoriels et les données de conversation sont perdus à chaque redémarrage d'instance. |
| `secret_environment_variables` (clés API) | Utiliser les références Secret Manager | Critique | Les clés API du fournisseur en texte clair `environment_variables` sont visibles dans les métadonnées de révision Cloud Run. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide échoue le job d'importation. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation entraîne l'échec de toutes les connexions à la base de données au démarrage. |
| `memory_limit` | `4Gi` | Élevé | Le pipeline d'intégration d'AnythingLLM nécessite 3 à 4 Gio de RAM ; les kills OOM corrompent l'ingestion en cours. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro provoque des démarrages à froid de 30 à 60 secondes ; les opérations d'IA en cours lors de la mise à l'échelle sont perdues. |
| `timeout_seconds` | `300` (augmenter pour les charges de travail lourdes) | Élevé | L'ingestion de documents longs ou les complétions LLM lentes dépassent le délai d'expiration du backend, renvoyant 504. |
| `EMBEDDING_ENGINE` | défini une fois | Élevé | La modification du moteur d'intégration après l'ingestion rend les vecteurs existants incompatibles ; tous les documents doivent être réintégrés. |
| `ingress_settings` / `enable_iap` | sécurisé pour la production | Élevé | `ingress_settings = "all"` sans IAP expose l'espace de travail publiquement ; seul le formulaire de connexion le protège. |
| `enable_nfs` / GCS Fuse | activer pour multi-instance | Élevé | Sans stockage partagé, les instances > 1 ont chacune une vue de stockage isolée ; l'accès aux documents inter-instances échoue. |
| `execution_environment` | `gen2` (par défaut) | Élevé | Les montages NFS et GCS Fuse nécessitent la génération 2 ; avec la génération 1, le volume ne parvient pas à se monter silencieusement. |
| `enable_redis` | `false` (ou définir `redis_host`) | Moyen | Si `enable_redis = true` et `redis_host` n'est pas résolvable, le conteneur ne démarre pas. |
| `application_version` | épingler à un tag de version | Moyen | `latest` risque des mises à niveau de schéma cassantes en production. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingestion et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
AnythingLLM partagée avec la variante GKE est décrite dans
**[AnythingLLM_Common](AnythingLLM_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : AnythingLLM sur Cloud Run](../labs/AnythingLLM_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [AnythingLLM sur GKE Autopilot](AnythingLLM_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [AnythingLLM Common — Configuration d'application partagée](AnythingLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Outline sur Google Cloud Run](Outline_CloudRun.md), [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md) dans la solution **Assistant de Connaissances d'Équipe**.
