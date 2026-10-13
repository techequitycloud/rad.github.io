---
title: "Listmonk sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Listmonk sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Listmonk_CloudRun.md @ e69407af sha256:5c0fa4c52328 -->

# Listmonk sur Google Cloud Run {#listmonk-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Listmonk_CloudRun.png" alt="Listmonk sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module `modules/Listmonk_CloudRun`. Il couvre l'architecture, la gestion des identités et des accès (IAM), les variables de configuration, les comportements spécifiques à Listmonk et les modèles opérationnels pour le déploiement de Listmonk sur Google Cloud Run (v2).

---

## Ce que coûte Listmonk sur RAD, et comment cela se compare {#what-listmonk-costs-on-rad-and-how-that-compares}

**Listmonk sur le module Cloud Run de RAD coûte environ 68 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).** Listmonk lui-même est gratuit et open source (AGPL), sans limite d'abonnés, il s'agit donc du coût d'infrastructure de votre propre gestionnaire de listes de diffusion plutôt que de frais SaaS par abonné. Si vous n'en avez besoin qu'occasionnellement — une campagne saisonnière, un envoi de newsletter unique — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 68 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **68 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour**, environ 780 par mois (environ 78 $ US au prix de la recharge, 62 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet
géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les
applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 0,5 GiB (scaleToZero) | 10,78 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 68 $ US** |

### Comment cela se compare {#how-it-compares}

- **Il n'existe pas de SaaS Listmonk hébergé officiel** — Zerodha l'a conçu pour l'auto-hébergement, et il n'y a pas de prix fournisseur à comparer. La comparaison commerciale la plus proche est un SaaS d'e-mail par abonné (Mailchimp, SendGrid Marketing), un modèle de tarification entièrement différent, nous n'en citons donc pas ici.
- **Dimensionné à son défaut de 1 vCPU/0,5 GiB, une classe de VPS plus petite/moins chère que la comparaison habituelle** (bien en dessous d'un Hetzner CPX22 ou DO 2 vCPU/4 Go à 24 $/mois) peut exécuter Listmonk et Postgres ensemble — moins les sauvegardes gérées par RAD, Secret Manager et la surveillance liée à la délivrabilité.
- La proposition de valeur de Listmonk (des millions d'abonnés sur un seul binaire Go, pas de frais par abonné) tient dans tous les cas ; RAD supprime principalement le travail opérationnel.
- Voir le [guide GKE](Listmonk_GKE.md) pour un déploiement qui reste disponible en continu.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Listmonk s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les
30 jours pour presque rien.** Cela convient bien mieux à Listmonk dont vous n'avez besoin qu'occasionnellement — un
projet de cours, une démo, une évaluation de courte durée — que de le faire fonctionner
en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD commence par délier sa facturation, puis
  demande à Google de supprimer le projet. Google ne supprime pas le projet
  immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà
  déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne
  détruit pas Cloud SQL ou le propre calcul de Listmonk un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et
  de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque
  déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement,
  cette mise à jour trouve les mêmes ressources déjà présentes — il s'agit d'une vérification,
  pas d'une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Pour Listmonk
  derrière un petit Services_GCP et Project_GCP, cela représente **une poignée de crédits
  (moins de 1 $ US)** au total, contre les 80 crédits que coûte un
  redéploiement complet.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne
  gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après
  cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart
  des services sont à nouveau entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes de Listmonk
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé
  par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Listmonk et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable
  à l'intérieur, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ
  80 crédits (8,00 $ US), car RAD
  recrée le projet et les services partagés avant Listmonk. La suppression permet d'économiser de l'argent
  seulement une fois que Listmonk resterait inutilisé pendant environ quatre jours
  ou plus, à la fois dans votre propre projet (environ 2,26 $ US par jour) et dans
  un projet géré par RAD (26 crédits par jour).
- **Supprimez tout ce que Listmonk utilise.** La majeure partie du coût d'exécution est généralement la base de données. Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Listmonk alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Listmonk.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement
  et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous
  voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Listmonk pour une classe. Chaque
  participant obtient Listmonk dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places
  à l'avance, soit chaque participant paie pour la sienne. Tout est supprimé lorsque la
  session se termine, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Listmonk pour un client
  à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le
  portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  frais inattendus. À la fin de l'engagement, le partenaire transfère le projet,
  et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et l'estimation quotidienne de 26 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans
suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble du module {#1-module-overview}

Listmonk est un gestionnaire de newsletters et de listes de diffusion auto-hébergé, performant, écrit en Go. `Listmonk CloudRun` est un **module enveloppe** construit au-dessus de `App CloudRun`. Il utilise `App CloudRun` pour toutes les provisions d'infrastructure GCP et injecte la configuration d'application spécifique à Listmonk, l'initialisation de la base de données et la configuration de stockage via `Listmonk Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur binaire Go, 1 vCPU / 512 Mio par défaut. Mise à l'échelle à zéro par défaut (`min_instance_count = 0`) avec `max_instance_count = 1` ; `cpu_always_allocated = true` maintient le CPU alloué sur une instance réveillée afin que l'expéditeur de campagne asynchrone puisse terminer avant de se réduire.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Volume GCS Fuse optionnel pour les téléchargements de médias à `/listmonk/uploads`. NFS optionnel pour un stockage partagé supplémentaire.
*   **Sécurité** : Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`. Le mot de passe administrateur est auto-généré et stocké dans Secret Manager.
*   **Mise en cache** : Redis **désactivé par défaut** (`enable_redis = false`). Listmonk est un binaire Go sans état et ne nécessite pas Redis pour un fonctionnement normal.
*   **CI/CD** : Pipeline d'images personnalisées Cloud Build par défaut ; livraison progressive Cloud Deploy optionnelle.
*   **Fiabilité** : La sonde de démarrage est une vérification de port TCP (délai initial de 30 secondes, 30 tentatives) — `/api/health` nécessite une authentification de session et renvoie un 403 pour une sonde HTTP, donc Cloud Run vérifie que le conteneur écoute à la place. La sonde de vivacité est désactivée par défaut (Cloud Run n'a pas de sonde de vivacité TCP, et `/api/health` renvoie également un 403). Listmonk exécute automatiquement les migrations de schéma PostgreSQL au premier démarrage.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des e-mails pour les alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Étiquettes appliquées à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'listmonk'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Listmonk'` | Nom lisible par l'homme affiché dans la console GCP. |
| `description` | 3 | `string` | `'Listmonk is a high-performance, self-hosted newsletter and mailing list manager'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'latest'` | Tag de version de l'image Listmonk. Incrémenter pour déployer une nouvelle version. |

**Architecture de l'enveloppe :** `Listmonk CloudRun` appelle `Listmonk Common` pour construire un objet `application_config` contenant les variables d'environnement spécifiques à Listmonk, la configuration des sondes et la définition du job `db-init`. `module_storage_buckets` transporte tout bucket de téléchargement provisionné par `Listmonk Common`. `scripts_dir` est résolu au répertoire `Listmonk_Common/scripts` au moment de l'apply.

**Note PostgreSQL :** Listmonk nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et Listmonk ne démarrera pas avec un autre moteur de base de données.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Listmonk_CloudRun` délègue toutes les provisions IAM à `App_CloudRun`. Les ensembles de rôles SA Cloud Run, SA Cloud Build, agent de service IAP et rotation de mot de passe sont identiques à ceux de `App_CloudRun`.

**Secrets d'application :** `Listmonk Common` génère automatiquement un secret au niveau de l'application :
- `LISTMONK_ADMIN_PASSWORD` — le mot de passe de l'utilisateur administrateur de Listmonk, stocké dans Secret Manager et injecté à l'exécution (le nom de configuration déprécié à double underscore `LISTMONK_app__admin_password` a été supprimé — `__` n'est pas une clé de Secret k8s valide).

Le mot de passe de la base de données est stocké dans un secret distinct (`database_password_secret`) provisionné automatiquement par `App CloudRun`. Aucune de ces valeurs n'est écrite dans l'état Terraform.

**Nom de la variable d'environnement du mot de passe de la base de données :** Listmonk lit `LISTMONK_db__password` directement. La variable `db_password_env_var_name` est pré-définie à cette valeur afin que `App CloudRun` injecte le secret sous le nom correct.

**Délai de propagation IAM de 120 secondes :** Hérité de `App CloudRun` — le service Listmonk n'est pas déployé tant que le délai n'est pas écoulé, ce qui évite les échecs de lecture de secret au premier démarrage de la révision.

**Interface d'administration :** L'interface utilisateur complète de Listmonk, y compris la gestion des abonnés, les campagnes, les modèles et les paramètres, est disponible à la racine `/`. Le nom d'utilisateur administrateur et le mot de passe auto-généré sont les seules informations d'identification requises.

---

## 3. Configuration du service de base {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Listmonk est un binaire Go compilé. Il est économe en mémoire et démarre rapidement par rapport aux applications en langage interprété. L'allocation de ressources par défaut (1 vCPU / 512 Mio) est suffisante pour des listes de taille modérée et des charges de travail de campagne.

**Mise à l'échelle à zéro par défaut** (`min_instance_count = 0`) — l'ancien défaut `min = 1` n'existait que pour maintenir le cache API-utilisateur en mémoire par instance chaud. Cette raison a disparu : l'entrée `Listmonk_Common` UPSERT un utilisateur API déterministe et basé sur un secret dans la base de données à chaque démarrage, de sorte qu'une instance démarrée à froid recharge toujours une information d'identification valide. `cpu_always_allocated = true` (par défaut) garantit qu'une instance réveillée maintient le CPU alloué suffisamment longtemps pour que l'expéditeur de campagne asynchrone puisse terminer avant de se réduire. Augmentez `min_instance_count` à `1` uniquement si Listmonk doit rester chaud pour une utilisation administrative interactive intensive.

Le **Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image du conteneur :** `container_image_source` par défaut à `'custom'`, ce qui signifie que Cloud Build compile une image personnalisée à l'aide du Dockerfile de `Listmonk_Common`. Définissez `container_image_source = 'prebuilt'` et fournissez un URI `container_image` pour ignorer la construction et déployer directement.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure (SQL, stockage, secrets). |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. 1 vCPU est suffisant pour le binaire Go de Listmonk. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. Augmentez à 1–2 Gi pour les grandes listes d'abonnés ou le traitement intensif des campagnes. |
| `min_instance_count` | 4 | `0` | Instances minimales en cours d'exécution. Mise à l'échelle à zéro ; l'utilisateur API auto-réparateur et amorcé par la base de données rend les démarrages à froid sûrs. |
| `max_instance_count` | 4 | `1` | Instances maximales en cours d'exécution. Maintenu à 1 — Listmonk n'a pas de coordination pour les processeurs de campagne concurrents. |
| `cpu_always_allocated` | 4 | `true` | Maintient le CPU alloué pendant toute la durée de vie d'une instance en cours d'exécution afin que l'expéditeur de campagne asynchrone intégré puisse terminer après le retour de la requête HTTP déclenchante. |
| `container_port` | 4 | `9000` | Port HTTP natif de Listmonk. Ne modifiez que si votre Dockerfile personnalisé se lie à un port différent. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. Les points de terminaison de l'API de Listmonk répondent généralement en quelques secondes. |
| `enable_cloudsql_volume` | 4 | `true` | Injecte le sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix à PostgreSQL. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Listmonk dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Allocation de trafic canary/bleu-vert basée sur un pourcentage. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. Définissez `0` pour désactiver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Étiquettes appliquées au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Listmonk CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `9000` | Port natif de Listmonk. |
| `cpu_always_allocated` | `false` | `true` | L'expéditeur de campagne intégré s'exécute après le retour de la requête HTTP déclenchante ; la facturation basée sur les requêtes le ralentirait en cours de lot. |
| `enable_image_mirroring` | `false` | `true` | Listmonk met en miroir son image de base vers Artifact Registry par défaut pour éviter les limites de débit de Docker Hub. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Listmonk nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et ne doit pas être modifiée. Listmonk gère sa propre création de schéma et ses migrations au premier démarrage — le job Cloud Run `db-init` ne crée que la base de données et l'utilisateur ; l'application peuple le schéma.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Listmonk nécessite PostgreSQL. Ne pas modifier. |
| `db_name` | 12 | `'listmonk'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `db_user` | 12 | `'listmonk'` | Utilisateur de l'application PostgreSQL. Mot de passe auto-généré et stocké dans Secret Manager. |
| `db_password_env_var_name` | 12 | `'LISTMONK_db__password'` | Nom de la variable d'environnement sous laquelle le mot de passe de la base de données est injecté. Pré-défini pour Listmonk ; ne pas modifier. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |

> `sql_instance_name` et `sql_instance_base_name` ne sont pas exposés ; la découverte/provisionnement en ligne de Cloud SQL est gérée de manière transparente par `App CloudRun`.

### C. Stockage (GCS Fuse et NFS) {#c-storage-gcs-fuse--nfs}

**NFS est désactivé par défaut** (`enable_nfs = false`). Listmonk est un binaire Go sans état et ne nécessite pas de stockage de système de fichiers partagé. Plusieurs instances Cloud Run partagent une seule base de données PostgreSQL ; les données des abonnés et le contenu des campagnes sont stockés dans la base de données.

**Volume de téléchargements GCS Fuse :** Pour un stockage persistant des téléchargements de médias/fichiers, montez un bucket GCS à `/listmonk/uploads` en utilisant `gcs_volumes`. `Listmonk Common` définit `LISTMONK_upload__provider=filesystem` et `LISTMONK_upload__filesystem__upload_path=/listmonk/uploads` — le bucket GCS monté à ce chemin satisfait ces paramètres. Sans volume persistant, les pièces jointes téléchargées sont éphémères et perdues lors du redémarrage de la révision.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Montez le bucket de téléchargements à `/listmonk/uploads`. |
| `enable_nfs` | 11 | `false` | Provisionne un volume NFS partagé. Non requis pour les déploiements Listmonk standard. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où le partage NFS est monté. Pertinent uniquement lorsque `enable_nfs = true`. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS définie dans `storage_buckets`. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés/clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement d'images CMEK au repos. |

### D. Réseautage {#d-networking}

Cloud Run utilise Direct VPC Egress pour atteindre l'IP interne de Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, le sidecar Auth Proxy gère la connexion Cloud SQL via un socket Unix, et la connexion à la base de données ne nécessite pas de routage VPC.

Listmonk se connecte à des fournisseurs SMTP/Mailgun/SES/Postmark externes pour la livraison des campagnes. Assurez-vous que `vpc_egress_setting = 'PRIVATE_RANGES_ONLY'` (par défaut) est activé afin que l'accès public direct soit disponible pour les ports SMTP 587/465/25.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — Internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à travers l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ne route que le trafic RFC 1918 via VPC. Définissez `'ALL_TRAFFIC'` uniquement si tout le trafic sortant (y compris SMTP) doit transiter par le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est automatiquement provisionné par `Listmonk Common` lorsque `initialization_jobs` est laissé comme liste vide par défaut (`[]`). Il utilise l'image `postgres:15-alpine` et exécute `Listmonk_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via le socket Unix du proxy d'authentification.
2. Crée l'utilisateur de base de données `listmonk` avec le mot de passe de Secret Manager.
3. Crée la base de données `listmonk` si elle n'existe pas.
4. Accorde à l'utilisateur `listmonk` tous les privilèges sur la base de données.

Listmonk lui-même exécute `--install` au premier démarrage pour peupler le schéma et créer l'utilisateur administrateur en utilisant `LISTMONK_ADMIN_USER` (codé en dur à `"admin"` dans `main.tf`) et `LISTMONK_ADMIN_PASSWORD` de l'environnement — les anciens noms de style de configuration à double underscore `LISTMONK_app__admin_username`/`LISTMONK_app__admin_password` ont été supprimés (v6-déprécié ; `__` n'est pas une clé de Secret k8s valide).

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run à exécution unique. Laissez vide pour que `Listmonk Common` fournisse le job `db-init` par défaut. Une liste non vide le remplace entièrement. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. Chaque entrée : `name`, `schedule` (cron UTC), `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit) est provisionné devant Cloud Run.

Pour les déploiements Listmonk en production traitant les données des abonnés et envoyant des campagnes, Cloud Armor est fortement recommandé pour se protéger contre le credential stuffing sur la connexion administrateur et l'abus d'API.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau, IPs de sortie CI/CD). |

### B. Proxy conscient de l'identité (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. L'authentification par identité Google est requise avant que les requêtes n'atteignent Listmonk. Recommandé pour les déploiements de newsletters internes où l'accès doit être restreint aux comptes Google organisationnels.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès. Format : `'group:name@example.com'`. |

### C. Autorisation binaire {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run impose que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image. Nécessite une politique d'autorisation binaire et un attestateur préconfigurés dans le projet. |

### D. Contrôles de service VPC {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont liés à un périmètre VPC-SC existant.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |
| `vpc_sc_dry_run` | 22 | `true` | Enregistre les violations VPC-SC sans les bloquer. Définissez `false` pour appliquer. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets d'application Listmonk sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état Terraform.

`Listmonk Common` génère automatiquement le secret du mot de passe administrateur, injecté dans le conteneur sous le nom `LISTMONK_ADMIN_PASSWORD`. Le mot de passe de la base de données (`LISTMONK_db__password`) est provisionné automatiquement par `App CloudRun`. Des secrets supplémentaires peuvent être ajoutés via `secret_environment_variables`.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappage du nom de la variable d'environnement → ID du secret Secret Manager. Résolu à l'exécution ; jamais stocké dans l'état. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne procèdent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global soutenu par un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

La définition de `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Listmonk à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS.

**Considération Listmonk :** Listmonk sert un mélange de points de terminaison d'API et d'actifs statiques. Le CDN est le plus bénéfique pour les actifs d'interface utilisateur statiques (HTML, JS, CSS). Les réponses de l'API Listmonk (`/api/*`) ne sont pas cachables et doivent être exclues de la mise en cache CDN via les en-têtes Cache-Control ou les règles de modèle d'URL.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. N'est efficace que lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées (pendantes) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. Définissez `0` pour désactiver la suppression basée sur l'âge. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont attachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Certificats SSL gérés par Google provisionnés par domaine. (par exemple, `['newsletters.example.com']`) |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés. Le déclencheur construit et déploie une image Listmonk personnalisée lorsque le code est poussé vers la branche configurée.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. Nécessite `github_repository_url` et des informations d'identification. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (scopes `repo`, `admin:repo_hook`). Requis lors de la première application. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (préféré pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est mis à niveau vers un pipeline de livraison Cloud Deploy géré avec des étapes de promotion séquentielles.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

Listmonk est un binaire Go sans état — plusieurs instances Cloud Run peuvent servir des requêtes simultanément sans problèmes d'état de session partagé. Le `min_instance_count = 0` par défaut se met à l'échelle à zéro entre les envois ; l'utilisateur API auto-réparateur et amorcé par la base de données signifie qu'une instance démarrée à froid est immédiatement utilisable. `max_instance_count` par défaut à `1` car Listmonk n'a pas de coordination pour les processeurs de campagne concurrents — augmentez-le uniquement si la charge de lecture interactive/API l'exige.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge. La conception sans état de Listmonk rend les déploiements canary sûrs — toutes les requêtes partagent le même backend PostgreSQL quelle que soit l'instance qui les traite.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Allocation de trafic basée sur un pourcentage entre les révisions nommées. Toutes les entrées doivent totaliser 100. Une valeur vide envoie 100 % à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Listmonk expose un point de terminaison `/api/health` dédié, mais à partir de Listmonk v6.1.0, ce point de terminaison se trouve derrière l'authentification de session et renvoie `403 {"message":"invalid session"}` à un appelant non authentifié — donc une sonde HTTP contre celui-ci ne passe jamais. La sonde de démarrage par défaut est donc une vérification d'écoute de port **TCP** (confirme que le serveur est lié au port du conteneur), et la sonde de vivacité est désactivée par défaut (Cloud Run n'a pas de sonde de vivacité TCP, et la forme HTTP renverrait un 403 de la même manière). La sonde de démarrage TCP conditionne la disponibilité, et Cloud Run redémarre le conteneur s'il se termine.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="TCP", path="/api/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=10, failure_threshold=30 }` | Sonde de disponibilité au démarrage (TCP). Le conteneur ne reçoit pas de trafic tant que cela n'a pas réussi. |
| `liveness_probe` | 14 | `{ enabled=false, type="HTTP", path="/api/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Désactivée par défaut ; la sonde de démarrage TCP couvre la disponibilité. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/health" }` | Vérification de la disponibilité de Cloud Monitoring. Désactivée par défaut — activez-la et les alertes notifieront `support_users` si inaccessible. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |

**Comportement de la sonde de démarrage :** Le `failure_threshold=30` combiné avec `period_seconds=10` donne à Listmonk jusqu'à 300 secondes (plus le délai initial de 30 secondes) pour terminer l'installation du schéma au premier démarrage. C'est généreux — l'installation du schéma Listmonk se termine généralement en moins de 30 secondes sur une nouvelle instance PostgreSQL.

### D. Rotation automatique du mot de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job de rotation Cloud Run.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL, écrit une nouvelle version de secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Listmonk.

Listmonk rétablit sa connexion à la base de données au redémarrage et lit le mot de passe mis à jour de Secret Manager.

| Variable | Groupe | Défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique du mot de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après l'écriture du nouveau secret avant de redémarrer le service. |

---

## 8. Intégrations {#8-integrations}

### A. Envoi de courriels (SMTP / API) {#a-mail-sending-smtp--api}

Listmonk se connecte à des fournisseurs de messagerie externes pour l'envoi de campagnes et de messages transactionnels. Configurez le fournisseur de messagerie via l'interface d'administration de Listmonk dans **Settings → SMTP** après le déploiement. Les fournisseurs courants incluent Mailgun, Amazon SES, Postmark et SendGrid.

Listmonk prend en charge les intégrations SMTP et API natives (Mailgun, SES, Postmark, Sparkpost). Pour l'envoi de gros volumes, les intégrations API sont préférables au SMTP.

**Approche de configuration :** Les identifiants du fournisseur de messagerie ne sont pas définis via des variables de module. Après le déploiement, accédez à l'interface d'administration de Listmonk et configurez :
1. **Settings → SMTP** pour l'envoi basé sur SMTP.
2. **Settings → Sending settings** pour la limitation du débit (messages par minute), la concurrence et les paramètres de nouvelle tentative.

Pour conserver ces paramètres lors des redéploiements, exportez les paramètres de Listmonk sous forme de dump SQL et importez-les lors de la restauration.

### B. Importation et récupération de sauvegardes {#b-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde de base de données PostgreSQL existante dans l'instance Cloud SQL provisionnée. Cela s'exécute après le job `db-init` et avant le déploiement du service Listmonk.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Définissez `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complet (par exemple, `'gs://my-bucket/listmonk-backup.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### C. Observabilité et alertes {#c-observability--alerting}

Un test de disponibilité Cloud Monitoring peut interroger le point de terminaison `/api/health` depuis plusieurs emplacements mondiaux ; il est désactivé par défaut. Des règles d'alerte personnalisées peuvent surveiller les métriques Cloud Run et notifier `support_users`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/health" }` | Test de disponibilité : `enabled`, `path`, `check_interval`, `timeout`. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte métrique. Chaque : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées par les déclencheurs de test de disponibilité et de règles d'alerte. |

---

## 9. Exploration avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, utilisez la console GCP pour vérifier et explorer le déploiement de Listmonk.

**Service Cloud Run**

Accédez à **Cloud Run** dans la console et sélectionnez le service `listmonk` (nommé `app<listmonk><tenant><id>`). Points clés à examiner :
- **Onglet Revisions** : Affiche toutes les révisions de conteneurs déployées, les pourcentages d'allocation de trafic et les digests d'images de conteneurs. La révision active doit afficher la balise `latest` ou une version spécifique.
- **Onglet Logs** : Diffuse les logs de conteneurs Cloud Run en temps réel. Filtrez par `severity=ERROR` pour afficher les problèmes de démarrage de Listmonk ou de connexion à la base de données. Au premier démarrage, recherchez les lignes de log d'installation du schéma de Listmonk (`Running install...`, `Admin user created`).
- **Onglet Metrics** : Affiche le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et la latence de démarrage des conteneurs. Un pic du nombre d'instances lors d'un envoi de campagne important est attendu.
- **Onglet YAML** : Affiche la spécification complète du service Cloud Run, y compris les noms des variables d'environnement (pas les valeurs), les montages de volumes, la configuration des sondes de santé et les limites de ressources.

**Secret Manager**

Accédez à **Secret Manager** et filtrez par le nom du déploiement. Deux secrets sont pertinents :
- `app<listmonk><tenant><id>-admin-password` ou similaire — le secret qui soutient la variable d'environnement de conteneur `LISTMONK_ADMIN_PASSWORD`. Cliquez sur **View secret versions** pour confirmer qu'une version existe. **Ne cliquez pas sur View secret value** en production.
- `app<listmonk><tenant><id>-db-password` — le secret du mot de passe PostgreSQL. Utilisé à la fois par le service Cloud Run et le job `db-init`.

Sélectionnez l'un ou l'autre secret et examinez l'onglet **Replication** pour confirmer que le secret est répliqué dans la région de déploiement.

**Cloud SQL**

Accédez à **SQL** et ouvrez l'instance Listmonk Cloud SQL. Points clés :
- **Overview** : Confirme le moteur PostgreSQL 15, le niveau de l'instance et la taille du stockage.
- **Onglet Databases** : La base de données `listmonk` doit être listée. Après le premier déploiement, les tables de schéma de Listmonk seront présentes.
- **Onglet Users** : L'utilisateur de l'application `listmonk` doit être listé.
- **Onglet Connections** : Examinez **Authorized networks** et confirmez que seul le proxy d'authentification Cloud SQL (via le compte de service Cloud Run) a accès. Aucune IP publique ne devrait être requise.
- **Onglet Backups** : Confirme le calendrier de sauvegarde automatisée et liste les fichiers de sauvegarde récents.
- **Onglet Operations** : Affiche les opérations récentes, y compris l'historique de connexion du job `db-init`.

**Cloud Build**

Accédez à **Cloud Build → History** pour examiner les exécutions de build récentes. Le déploiement initial déclenche un build pour empaqueter l'image de conteneur Listmonk. Chaque entrée de build affiche la balise de l'image, la durée du build et les logs au niveau des étapes. Cliquez sur un build pour voir les étapes du Dockerfile et le `docker push` final vers Artifact Registry.

**Artifact Registry**

Accédez à **Artifact Registry** et ouvrez le dépôt `listmonk`. Le dépôt liste toutes les balises d'image poussées avec leurs digests, horodatages de poussée et tailles. Confirmez que la dernière image est présente.

**Cloud Monitoring**

Accédez à **Monitoring → Uptime checks** et trouvez le test de disponibilité Listmonk. Le test interroge `/api/health` depuis plusieurs emplacements mondiaux. Un statut vert confirme que le service est accessible et sain depuis le réseau mondial de GCP.

Accédez à **Monitoring → Alerting** pour voir les règles d'alerte actives créées par le module. `support_users` sont automatiquement ajoutés comme destinataires des canaux de notification.

---

## 10. Exploration avec gcloud {#10-exploring-with-gcloud}

Les commandes gcloud suivantes fournissent une visibilité opérationnelle sur le déploiement Listmonk Cloud Run. Remplacez `PROJECT_ID`, `REGION` et `SERVICE_NAME` par vos valeurs de déploiement. Le nom du service suit le modèle `app<listmonk><tenant><id>` — récupérez-le à partir de la sortie Terraform `service_name`.

**Récupérer l'URL du service et la configuration :**

```bash
# Get the Cloud Run service URL
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(status.url)"

# Describe the full service configuration
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format=yaml
```

**Vérifier la santé du service et les révisions :**

```bash
# List all revisions and their traffic allocations
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name,status.conditions[0].status,spec.containers[0].image,status.observedGeneration)"

# Check revision traffic split
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(spec.traffic[].percent,spec.traffic[].revisionName)"
```

**Diffuser et filtrer les logs :**

```bash
# Tail live logs from the Listmonk service
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME" \
  --project=PROJECT_ID \
  --limit=50 \
  --freshness=10m \
  --format="table(timestamp,severity,textPayload)"

# Filter for errors only
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME AND severity>=ERROR" \
  --project=PROJECT_ID \
  --limit=20

# View db-init job logs
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name~db-init" \
  --project=PROJECT_ID \
  --limit=30 \
  --format="table(timestamp,severity,textPayload)"
```

**Inspecter les secrets :**

```bash
# List all Secret Manager secrets in the project (filter by deployment)
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~listmonk" \
  --format="table(name,replication.automatic,createTime)"

# Check secret versions for the admin password
gcloud secrets versions list LISTMONK_ADMIN_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Access the admin password (use with caution — only in break-glass scenarios)
gcloud secrets versions access latest \
  --secret=LISTMONK_ADMIN_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID
```

**Inspection Cloud SQL :**

```bash
# List Cloud SQL instances
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,settings.tier,region,state)"

# Describe the Listmonk instance
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(databaseVersion,settings.tier,settings.ipConfiguration,state)"

# List databases on the instance
gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID

# List users on the instance
gcloud sql users list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Jobs Cloud Run (db-init) :**

```bash
# List all Cloud Run Jobs in the region
gcloud run jobs list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name,status.conditions[0].status,metadata.creationTimestamp)"

# Describe the db-init job
gcloud run jobs describe JOB_NAME \
  --region=REGION \
  --project=PROJECT_ID

# Manually execute the db-init job (e.g., after a database recreation)
gcloud run jobs execute JOB_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --wait
```

**Disponibilité et surveillance :**

```bash
# List uptime checks
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,checkerType)"

# List Cloud Monitoring alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].displayName)"
```

**Artifact Registry :**

```bash
# List images in the Listmonk repository
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/listmonk \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)" \
  --include-tags

# List all tags for the Listmonk image
gcloud artifacts docker tags list REGION-docker.pkg.dev/PROJECT_ID/listmonk/listmonk \
  --project=PROJECT_ID
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Listmonk CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Détail |
|---|---|
| **PostgreSQL 15 requis** | `database_type = "POSTGRES_15"` par défaut. Listmonk ne prend pas en charge MySQL ou d'autres moteurs. |
| **Mot de passe administrateur auto-généré** | Généré par `Listmonk Common` et injecté dans le conteneur sous le nom `LISTMONK_ADMIN_PASSWORD` (un seul underscore ; le nom de configuration déprécié `LISTMONK_app__admin_password` a été supprimé). Stocké dans Secret Manager, jamais dans l'état. |
| **Variable d'environnement du mot de passe DB pré-définie** | `db_password_env_var_name = "LISTMONK_db__password"` est pré-configuré afin que `App CloudRun` injecte le mot de passe de la base de données sous le nom correct pour la configuration de Listmonk. |
| **Chemin de téléchargement GCS Fuse** | `LISTMONK_upload__provider=filesystem` et `LISTMONK_upload__filesystem__upload_path=/listmonk/uploads` sont injectés automatiquement. Montez un bucket GCS à `/listmonk/uploads` via `gcs_volumes` pour les téléchargements persistants. |
| **Job db-init par défaut** | Fourni par `Listmonk Common` lorsque `initialization_jobs = []`. La base de données et l'utilisateur PostgreSQL sont créés automatiquement. |
| **Mise en miroir des images activée** | `enable_image_mirroring = true` par défaut. L'image de base Listmonk est mise en miroir dans Artifact Registry avant le déploiement. |
| **Redis désactivé par défaut** | `enable_redis = false`. Listmonk ne nécessite pas Redis pour un fonctionnement standard. |
| **Répertoire des scripts** | `scripts_dir` est résolu en `Listmonk_Common/scripts` au moment de l'apply. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Listmonk CloudRun`, triées par groupe d'interface utilisateur puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Requis.** |
| `region` | 1 | `'us-central1'` | Région GCP pour toutes les ressources. |
| `tenant_id` | 2 | `'demo'` | Court suffixe ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'listmonk'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `'Listmonk'` | Nom lisible par l'homme. |
| `description` | 3 | (description Listmonk) | Description du service. |
| `application_version` | 3 | `'latest'` | Balise de l'image de conteneur Listmonk. |
| `admin_username` | 3 | `'listmonk'` | Déclaré mais actuellement inutilisé par `main.tf` — le nom d'utilisateur administrateur initial est codé en dur à `"admin"` via `LISTMONK_ADMIN_USER`, quelle que soit la valeur de cette variable. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances en cours d'exécution. Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances en cours d'exécution. |
| `cpu_always_allocated` | 4 | `true` | Maintient le CPU alloué sur une instance en cours d'exécution afin que l'expéditeur de campagne asynchrone puisse terminer après le retour de la requête de déclenchement. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête en secondes. |
| `enable_cloudsql_volume` | 4 | `true` | Sidecar Auth Proxy pour les connexions de socket Unix à PostgreSQL. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket Unix Auth Proxy. |
| `container_port` | 4 | `9000` | Port HTTP natif de Listmonk. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Listmonk dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Allocation de trafic Canary/bleu-vert. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès à IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI complet) ou `'gdrive'` (ID de fichier). |
| `backup_uri` | 7 | `""` | URI GCS complet ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur Cloud Build GitHub. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image lors du déploiement. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base pour la VM NFS inline. L'ID de déploiement est ajouté. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lesquels les images sont éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `false` | Provisionne le stockage partagé NFS. Non requis pour les déploiements Listmonk standard. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. Monte le bucket de téléchargements à `/listmonk/uploads`. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Ne pas modifier — Listmonk nécessite PostgreSQL. |
| `db_name` | 12 | `'listmonk'` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `db_user` | 12 | `'listmonk'` | Utilisateur de l'application PostgreSQL. |
| `db_password_env_var_name` | 12 | `'LISTMONK_db__password'` | Nom de la variable d'environnement pour l'injection du mot de passe de la base de données. Ne pas modifier. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 14 | `{ enabled=true, type="TCP", path="/api/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Sonde de démarrage. TCP — `/api/health` nécessite une authentification de session. |
| `liveness_probe` | 14 | `{ enabled=false, type="HTTP", path="/api/health", initial_delay_seconds=30, failure_threshold=3, ... }` | Sonde de vivacité. Désactivée par défaut. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte métrique Cloud Monitoring. |
| `enable_redis` | 21 | `false` | Intégration Redis. Non requise pour Listmonk. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP Redis. |
| `redis_port` | 21 | `'6379'` | Port TCP Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe AUTH Redis. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR du sous-réseau VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans bloquer. Définissez `false` pour appliquer. |
| `organization_id` | 22 | `""` | ID d'organisation GCP pour VPC-SC. Découvert automatiquement à partir du projet si vide. |
| `enable_audit_logging` | 22 | `false` | Active les logs d'audit Cloud détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP où le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## 14. Pièges de configuration et valeurs par défaut judicieuses {#14-configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(requis)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Listmonk prend exclusivement en charge PostgreSQL. Le passage à MySQL ou SQL Server entraîne l'échec de Listmonk au démarrage. |
| `db_name` | `"listmonk"` | **Critique** | Immuable après le premier déploiement — la modification entraîne la recréation de la base de données par Terraform, détruisant tous les abonnés, campagnes et paramètres. |
| `db_user` | `"listmonk"` | **Critique** | Immuable après le premier déploiement — la modification recrée l'utilisateur Cloud SQL et invalide toutes les informations d'identification stockées. |
| `db_password_env_var_name` | `"LISTMONK_db__password"` | **Critique** | Listmonk lit ce nom exact de variable d'environnement pour son mot de passe de base de données. Le modifier entraîne l'échec de la connexion de Listmonk à PostgreSQL au démarrage. |
| `min_instance_count` | `0` | **Faible** | La mise à l'échelle à zéro est la valeur par défaut et est sûre : l'utilisateur de l'API auto-réparatrice de la base de données signifie qu'une instance démarrée à froid recharge toujours une information d'identification valide, et `cpu_always_allocated = true` maintient l'expéditeur de campagne asynchrone de l'instance réveillée en cours d'exécution jusqu'à la fin. N'augmentez à `1` que pour une utilisation administrative interactive intensive où les démarrages à froid sont indésirables. |
| `memory_limit` | `"512Mi"` | **Moyen** | Suffisant pour les petites listes. Les listes avec des millions d'abonnés ou un traitement de campagne concurrent peuvent épuiser 512 Mio sous charge. Augmentez à 1–2 Gio pour les déploiements de production avec un grand nombre d'abonnés. |
| `enable_cloudsql_volume` | `true` | **Critique** | Listmonk se connecte à PostgreSQL via le socket Unix Auth Proxy par défaut. La désactivation du volume sans fournir de chemin de connexion TCP entraîne l'échec de toutes les opérations de base de données. |
| `gcs_volumes` | `[]` | **Moyen** | Sans un volume GCS Fuse à `/listmonk/uploads`, les téléchargements de fichiers multimédias sont stockés de manière éphémère sur le système de fichiers du conteneur et perdus lorsque la révision est remplacée. Configurez pour tout déploiement qui accepte les pièces jointes ou les téléchargements de médias. |
| `ingress_settings` | `"all"` | **Moyen** | `"all"` expose l'interface d'administration de Listmonk à l'Internet public. Pour les déploiements de newsletters internes, envisagez `enable_iap = true` ou `ingress_settings = "internal"`. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, l'API Listmonk et l'interface d'administration sont exposées sans protection WAF. Les listes d'abonnés à grande échelle sont des cibles précieuses pour le scraping. Recommandé pour tout déploiement de production. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour les bases de données d'abonnés de production. La perte de données d'abonnés, de l'historique des campagnes et des enregistrements de désabonnement constitue un risque de conformité sérieux. Augmentez à plus de 30 jours pour tout déploiement de production. |
| `enable_backup_import` | `false` | **Critique** | Nécessite que `backup_uri` soit un chemin GCS ou Drive valide et accessible. L'activation avec un `backup_uri` vide entraîne l'échec du job Cloud Run de restauration lors de l'apply. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **Moyen** | Listmonk doit atteindre les fournisseurs SMTP/API externes pour l'envoi de campagnes. `PRIVATE_RANGES_ONLY` permet une sortie publique directe. Le passage à `"ALL_TRAFFIC"` avec un pare-feu VPC restrictif bloquera les connexions SMTP/API sortantes et empêchera silencieusement la livraison des campagnes. |
| `secret_propagation_delay` | `30` | **Faible** | Parfois insuffisant dans les configurations multi-régions. Augmentez à 60–90 s si les secrets ne sont pas trouvés lors de l'apply. |

---

## 15. Destruction des ressources {#15-destroying-resources}

### Problème de suppression connu : Libération d'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** Attendez 20 à 30 minutes après la tentative de destruction initiale, puis réexécutez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Listmonk sur Cloud Run](../labs/Listmonk_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Listmonk GKE — Guide de configuration](Listmonk_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Listmonk](Listmonk_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Twenty CRM sur Google Cloud Run](Twenty_CloudRun.md), [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **CRM & Opérations de vente**.
