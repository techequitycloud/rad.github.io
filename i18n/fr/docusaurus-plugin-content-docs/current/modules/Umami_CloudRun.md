---
title: "Umami sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Umami sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Umami_CloudRun.md @ e69407af sha256:9d7b775b2146 -->

# Umami sur Google Cloud Run {#umami-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Umami_CloudRun.png" alt="Umami sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module Terraform `modules/Umami_CloudRun`. Il couvre l'architecture, la gestion des identités et des accès (IAM), les variables de configuration, les comportements spécifiques à Umami et les modèles opérationnels pour le déploiement d'Umami sur Google Cloud Run (v2).

---

## Ce que coûte Umami sur RAD, et comment cela se compare {#what-umami-costs-on-rad-and-how-that-compares}

**L'exécution d'Umami sur Cloud Run dans votre propre projet Google Cloud coûte environ 67,80 $ US/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits (7,50 $ US) facturé une fois au moment du déploiement. Umami est une plateforme d'analyse web axée sur la confidentialité, sans cookies — une alternative auto-hébergée à Google Analytics — et sa base de données Postgres représente la majeure partie de ce coût d'exécution. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous — ou voir le [guide GKE](Umami_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 67,80 $ US/mois, facturé par Google au prix catalogue | ~26 crédits/jour (environ 780/mois, 78 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un abonnement mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 0,5 GiB (scaleToZero) | 10,78 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **67,80 $ US** |

### Comment cela se compare {#how-it-compares}

- **Umami Cloud**, la solution hébergée par Umami, propose un niveau Hobby gratuit (jusqu'à 100 000 événements/mois, un site web), puis Pro à 20 $/mois (1 million d'événements, jusqu'à 20 sites web) et Business à 200 $/mois (10 millions d'événements, sites web illimités), avec Enterprise sur devis — vérifié sur la page de tarification d'Umami, le 8 octobre 2026. Le coût du projet propre de RAD se situe entre Pro et Business en termes de prix affiché, mais n'est pas mesuré par événement : les pics de trafic ne déclenchent pas de mise à niveau.
- Une comparaison avec un VPS autogéré, dimensionné selon la configuration légère par défaut d'Umami de 1 vCPU / 0,5 GiB : un Hetzner CPX11 ou un Droplet DigitalOcean de 1 vCPU/2 Go coûte environ 6 à 12 $/mois — moins cher en espèces, plus votre propre temps pour les sauvegardes et les correctifs Postgres, que le Cloud SQL géré par RAD et Secret Manager couvrent pour vous.
- Étant donné que les plans hébergés par Umami sont mesurés en fonction des événements de pages vues et que celui de RAD ne l'est pas, le choix le moins cher dépend entièrement du volume de trafic — RAD est mieux adapté une fois qu'un site dépasse le niveau Hobby d'Umami Cloud et continue de croître.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et cela ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne supprime **pas** Cloud SQL, une VM ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Une véritable lacune : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logique de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Umami et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources pour de bon, et la remise en service d'Umami signifie un redéploiement
à partir de zéro. Cela coûte environ 78 à 81 crédits dans votre propre projet, ou environ
70,5 à 73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Umami reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — environ 4 jours ou plus dans votre propre projet
(environ 2,26 $ US par jour), ou environ 3 jours ou plus dans un projet géré par RAD
(26 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration ; [tarification Umami](https://umami.is/pricing).

## 1. Vue d'ensemble du module {#1-module-overview}

Umami est une plateforme d'analyse web open-source, légère et axée sur la confidentialité — une alternative auto-hébergée à Google Analytics. Elle collecte le trafic du site web et les données d'événements sans cookies ni données personnelles, ce qui la rend conforme aux réglementations GDPR, CCPA et PECR dès sa sortie de l'emballage. `Umami CloudRun` est un **module enveloppant** construit sur `App CloudRun`. Il utilise `App CloudRun` pour toutes les provisions d'infrastructure GCP et injecte la configuration d'application spécifique à Umami, l'initialisation de la base de données et la gestion des secrets via `Umami Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Next.js, 1 vCPU / 512 Mio par défaut. Le scale-to-zero (`min_instance_count = 0`) est pris en charge ; `max_instance_count` par défaut à 3.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. Aucun stockage GCS n'est provisionné par défaut.
*   **Sécurité** : `APP_SECRET` auto-généré par `Umami Common` et stocké dans Secret Manager. Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`.
*   **Confidentialité** : Aucun cookie utilisé par défaut, aucune donnée personnelle stockée, entièrement conforme GDPR/CCPA/PECR.
*   **Point de terminaison de santé** : Umami expose `/api/heartbeat` comme point de terminaison de santé. Les sondes de démarrage et de vivacité ciblent ce chemin.
*   **CI/CD** : Pipeline d'images Cloud Build personnalisé par défaut ; livraison progressive Cloud Deploy en option.
*   **Suivi** : Après le déploiement, intégrez `<script async src="https://<your-url>/script.js" data-website-id="..."></script>` dans les sites web suivis.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `string` | `'us-central1'` | Région GCP pour toutes les ressources. |
| `tenant_id` | 2 | `string` | `'demo'` | Court suffixe ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des alertes de surveillance par e-mail. |
| `resource_labels` | 2 | `map(string)` | `{}` | Étiquettes appliquées à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'umami'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `application_display_name` | 3 | `string` | `'Umami'` | Nom lisible par l'homme affiché dans la console GCP. |
| `application_description` | 3 | `string` | `'Umami Analytics on Cloud Run'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'postgresql-latest'` | Tag de version de l'image Umami. Utilisez un tag préfixé `postgresql-` (par exemple, `postgresql-latest`, `postgresql-v2.11.3`). |

**Architecture de l'enveloppe :** `Umami CloudRun` appelle `Umami Common` pour construire un objet `application_config` contenant les variables d'environnement spécifiques à Umami, la configuration des sondes et la définition du job `db-init`. `module_secret_env_vars` transporte `APP_SECRET` de `Umami Common`. Le `DATABASE_URL` est construit à l'exécution à partir des variables de plateforme DB_* injectées par `App CloudRun`. `scripts_dir` est résolu en `abspath("${module.umami_app.path}/scripts")` au moment de l'apply.

**Note PostgreSQL :** Umami nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et ne doit pas être modifiée.

**Identifiants administrateur par défaut :** Lors du premier déploiement, connectez-vous avec le nom d'utilisateur `admin` et le mot de passe `umami`. Changez-les immédiatement après la première connexion.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Umami_CloudRun` délègue toutes les provisions IAM à `App_CloudRun`. Le SA Cloud Run, le SA Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation de mot de passe sont identiques à ceux de [App_CloudRun](./App_CloudRun.md#group-0--module-metadata--platform-wiring).

**Secret d'application auto-généré :** `Umami Common` génère `APP_SECRET` au moment de l'apply en utilisant `random_password` (32 caractères, pas de caractères spéciaux). Il est écrit dans Secret Manager et injecté dans le conteneur Cloud Run en tant que variable d'environnement `APP_SECRET`. Le texte en clair n'est jamais stocké dans l'état Terraform après l'apply initial.

**Identité d'initialisation de la base de données :** Le job Cloud Run `db-init` s'exécute sous le SA Cloud Run. Il se connecte à Cloud SQL PostgreSQL via l'intégration native du socket Cloud SQL de Cloud Run (`run.googleapis.com/cloudsql-instances`, puisque `enable_cloudsql_volume = true` par défaut), en utilisant `DB_HOST` (le chemin du socket sous `/cloudsql`), `DB_USER` et `DB_PASSWORD` (depuis Secret Manager). Cloud Run n'a pas de sidecar Auth Proxy — ce mécanisme n'existe que sur GKE.

**Délai de propagation des secrets de 30 secondes :** `Umami Common` insère une attente de propagation après la création des secrets. La variable `secret_propagation_delay` (par défaut 30 secondes) contrôle le temps que les ressources dépendantes attendent après la création du secret avant de continuer.

Pour les tableaux de rôles complets et les détails IAP, de rotation de mot de passe et d'accès public, voir [App_CloudRun](./App_CloudRun.md#group-15--identity-aware-proxy).

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Umami est une application Next.js légère avec des exigences modestes en ressources. `Umami CloudRun` expose `cpu_limit` et `memory_limit` comme variables de haut niveau dédiées.

Le **scale-to-zero est pris en charge** (`min_instance_count = 0` par défaut). Les démarrages à froid d'Umami sont rapides — l'application est légère et n'a pas d'opérations de démarrage lentes.

Le **Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` par défaut à `'custom'`, ce qui signifie que Cloud Build construit une image wrapper qui mappe les variables d'environnement DB_* de la plateforme à `DATABASE_URL` d'Umami. Définissez `container_image_source = 'prebuilt'` et configurez `DATABASE_URL` manuellement pour déployer directement l'image officielle `ghcr.io/umami-software/umami`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définir `false` pour un déploiement uniquement d'infrastructure (SQL, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` construit via Cloud Build (mappe DB_* à DATABASE_URL). `'prebuilt'` déploie une URI d'image existante. |
| `container_image` | 4 | `'ghcr.io/umami-software/umami'` | Image de base. Surcharger pour utiliser une image personnalisée ou une copie miroir. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. 1 vCPU est suffisant pour la plupart des déploiements Umami. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. Augmenter à 1 GiB pour les sites à fort trafic. |
| `min_instance_count` | 4 | `0` | Instances minimales. Définir à `1` pour éviter les démarrages à froid. |
| `max_instance_count` | 4 | `3` | Instances maximales. Umami s'adapte horizontalement — tout l'état est dans PostgreSQL. |
| `container_port` | 4 | `3000` | Port HTTP natif d'Umami. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommandé pour les performances. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | 4 | `true` | Par défaut `true` — Umami se connecte via l'intégration native du socket Unix Cloud SQL de Cloud Run (pas de sidecar Auth Proxy sur Cloud Run — voir Section 3.D). |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes — le CPU n'est facturé que lors du traitement d'une requête. Définir `true` pour allouer le CPU en permanence (facturation basée sur l'instance). |
| `traffic_split` | 4 | `[]` | Allocation de trafic canari/bleu-vert basée sur un pourcentage. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Étiquettes appliquées au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Umami CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `3000` | Port Next.js natif d'Umami. |
| `cpu_limit` | `'1000m'` | `'1000m'` | Idem — Umami est léger. |
| `memory_limit` | `'512Mi'` | `'512Mi'` | Idem — Umami a des besoins en mémoire modestes. |
| `max_instance_count` | `1` | `3` | Umami s'adapte horizontalement en toute sécurité — tout l'état est dans PostgreSQL. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Umami nécessite **PostgreSQL 15**. Le module provisionne une instance Cloud SQL PostgreSQL 15 et crée une base de données et un utilisateur dédiés pour Umami.

**Construction de DATABASE_URL :** Le point d'entrée personnalisé (en mode image `custom`) construit `DATABASE_URL` à partir des variables `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` et `DB_PORT` injectées par la plateforme. Cela évite d'avoir à passer une chaîne de connexion en texte clair.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Doit être `POSTGRES_15` pour Umami. |
| `application_database_name` | 12 | `'umami'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `application_database_user` | 12 | `'umami'` | Utilisateur de l'application PostgreSQL. Mot de passe auto-généré et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `enable_postgres_extensions` | 12 | `false` | Active l'installation des extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | 12 | `[]` | Extensions PostgreSQL à installer (par exemple, `['uuid-ossp']`). |

### C. Stockage (GCS) {#c-storage-gcs}

**Pas de stockage par défaut.** Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. `storage_buckets` est par défaut une liste vide. Ne provisionnez des buckets supplémentaires que si nécessaire pour des cas d'utilisation personnalisés (par exemple, exportations de sauvegardes).

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Contrôle si le module provisionne les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | 11 | `[]` | Buckets GCS à provisionner. Vide par défaut — Umami ne nécessite pas de stockage de fichiers. |
| `enable_nfs` | 11 | `false` | Provisionne une instance NFS Cloud Filestore. Non requis pour Umami. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. Utilisé uniquement lorsque `enable_nfs = true`. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés CMEK KMS et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseautage {#d-networking}

Cloud Run utilise Direct VPC Egress pour atteindre l'IP interne de Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, l'intégration *native* Cloud SQL de Cloud Run (annotation `run.googleapis.com/cloudsql-instances`) monte un socket Unix à `/cloudsql/<proj:region:inst>` et injecte `DB_HOST` comme répertoire de ce socket. **Il n'y a pas de sidecar Auth Proxy et pas de listener TCP `127.0.0.1:5432` sur Cloud Run** — ce mécanisme n'existe que sur GKE, où un vrai sidecar `cloud-sql-proxy` écoute sur la boucle locale. Le point d'entrée `Umami_Common` (`scripts/umami-entrypoint.sh`, partagé avec `Umami_GKE`) résout un chemin de socket `DB_HOST` en `127.0.0.1` avant d'assembler `DATABASE_URL` — un mappage qui n'est valide que sur GKE. Sur Cloud Run, cela donne `ECONNREFUSED 127.0.0.1:5432` et un échec de la sonde de démarrage. Voir le tableau des pièges de configuration ci-dessous.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic via l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via VPC. `'ALL_TRAFFIC'` achemine tout l'egress via VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est automatiquement provisionné par `Umami Common` lorsque `initialization_jobs` est laissé comme liste vide par défaut (`[]`). Il utilise une image client PostgreSQL et exécute `Umami_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via l'intégration native du socket Unix Cloud SQL de Cloud Run (pas de sidecar Auth Proxy sur Cloud Run — voir Section 3.D).
2. Crée l'utilisateur de base de données `umami` avec le mot de passe de Secret Manager.
3. Crée la base de données `umami` si elle n'existe pas.
4. Accorde à l'utilisateur `umami` tous les privilèges sur la base de données.

Umami lui-même exécute ses propres migrations de base de données basées sur Prisma au premier démarrage — le job `db-init` ne fait que pré-créer la base de données et l'utilisateur afin que les migrations d'Umami puissent s'exécuter avec succès.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run à exécution unique. Laisser vide pour que `Umami Common` fournisse le job `db-init` par défaut. Une liste non vide le remplace entièrement. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés avec l'application principale. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit de 500 requêtes/min) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau, IP d'egress CI/CD). |

### B. Proxy conscient de l'identité (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. L'authentification Google Identity est requise avant que les requêtes n'atteignent Umami. Utile pour restreindre l'accès aux analyses aux seuls membres de l'équipe interne.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

**Note :** IAP protège le tableau de bord Umami. Le script de suivi (`/script.js`) et le point de terminaison d'événement (`/api/send`) doivent rester accessibles au public pour que les sites web suivis puissent rapporter des données. Si vous appliquez IAP, assurez-vous que les chemins de suivi sont exemptés ou utilisez une configuration d'entrée séparée.

### C. Autorisation binaire {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run s'assure que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image. Nécessite une politique d'autorisation binaire et un attestateur préconfigurés dans le projet. |

### D. Contrôles de service VPC {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont liés à un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Le `APP_SECRET` d'Umami est stocké dans Secret Manager et injecté nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état Terraform.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappage nom de variable d'environnement → ID de secret Secret Manager. Résolu à l'exécution ; jamais stocké dans l'état. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne continuent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global soutenu par un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

La définition de `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Umami à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`.

Voir [App_CloudRun](./App_CloudRun.md#group-16--cloud-armor--cdn) pour les détails complets de l'architecture.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS.

**Considération Umami :** Le tableau de bord d'Umami est une application Next.js dynamique. Cloud CDN est utile pour mettre en cache les actifs statiques d'Umami (bundles JavaScript, CSS) mais ne doit pas mettre en cache les réponses API (`/api/*`) qui contiennent des données d'analyse en direct. Assurez-vous que les en-têtes `Cache-Control` appropriés sont définis.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. N'est efficace que lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. Définir `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées (dangling) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. Définir `0` pour désactiver la suppression basée sur l'âge. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont attachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'adresse IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Certificats SSL gérés par Google provisionnés par domaine. (par exemple, `['analytics.example.com']`) |

Après le premier apply, récupérez l'IP de l'équilibreur de charge et créez un enregistrement `A`. Le provisionnement du certificat SSL prend 10 à 30 minutes après la propagation DNS.

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés. Le déclencheur construit et déploie une image Umami personnalisée lorsque du code est poussé vers la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. Nécessite `github_repository_url` et des identifiants. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (scopes `repo`, `admin:repo_hook`). Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (préféré pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est mis à niveau vers un pipeline de livraison Cloud Deploy géré avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` (scale-to-zero) par défaut. Les démarrages à froid d'Umami sont rapides — l'application Next.js démarre en quelques secondes sans opérations lourdes au premier démarrage. `max_instance_count = 3` par défaut. Umami s'adapte horizontalement en toute sécurité car tout l'état est dans PostgreSQL.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge. Umami stocke toutes les données d'analyse dans PostgreSQL (partagées entre toutes les instances), ce qui rend les déploiements canaris sûrs — toute révision peut servir des requêtes et écrire dans la même base de données.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Allocation de trafic basée sur un pourcentage entre les révisions nommées. Toutes les entrées doivent totaliser 100. Une liste vide envoie 100 % à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Umami expose `/api/heartbeat` comme point de terminaison de santé dédié. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, timeout_seconds=10, period_seconds=10, failure_threshold=30 }` | Sonde de disponibilité au démarrage. Le conteneur ne reçoit pas de trafic tant que celle-ci n'a pas réussi. |
| `liveness_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après `failure_threshold` échecs consécutifs. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30 }` | Sonde de démarrage Cloud Run (passée directement à `App CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de vivacité Cloud Run (passée directement à `App CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Vérification de la disponibilité de Cloud Monitoring (désactivée par défaut). Lorsqu'elle est activée, des alertes notifient `support_users` si inaccessible. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job de rotation Cloud Run.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL, écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Umami.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après l'écriture du nouveau secret avant de redémarrer le service. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de rotation. Par défaut : 30 jours. |

---

## 8. Intégrations {#8-integrations}

### A. Cache Redis {#a-redis-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Umami ne nécessite pas Redis — tout l'état est stocké dans PostgreSQL. Activez-le uniquement si vous intégrez une couche de mise en cache externe pour des cas d'utilisation personnalisés.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 16 | `false` | Active Redis en injectant les variables d'environnement `REDIS_HOST` et `REDIS_PORT`. Umami ne nécessite pas Redis. |
| `redis_host` | 16 | `""` | Nom d'hôte ou adresse IP du serveur Redis. Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | 16 | `'6379'` | Port TCP du serveur Redis (chaîne). |

### B. Importation et récupération de sauvegarde {#b-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL PostgreSQL provisionnée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Définir `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complète) ou `'gdrive'` (ID de fichier Drive). |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

### C. Observabilité et alertes {#c-observability--alerting}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Configuration de la vérification de la disponibilité : `enabled`, `path`, `check_interval`, `timeout`. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées par les déclencheurs de disponibilité et de politique d'alerte. |

### D. Exploration avec la console GCP {#d-exploring-with-the-gcp-console}

Après un déploiement réussi, explorez l'installation Umami dans la console GCP :

**Service Cloud Run :**
Accédez à **Cloud Run** dans la console GCP. Recherchez le service nommé `app<application_name><tenant_id><deployment_id>` (par exemple, `appumamidemoxyz`). Cliquez sur le service pour afficher :
- L'URL du service — utilisez-la pour accéder au tableau de bord Umami.
- L'onglet **Révisions** — liste toutes les révisions déployées avec les pourcentages de trafic.
- L'onglet **Journaux** — diffuse les journaux des conteneurs, y compris les journaux de démarrage et de requête d'Umami.
- L'onglet **Métriques** — affiche le nombre de requêtes, la latence, le nombre d'instances et l'utilisation du CPU/de la mémoire.
- L'onglet **Configuration** — affiche l'image de conteneur actuelle, les variables d'environnement (non sensibles) et les limites de ressources.

**Instance Cloud SQL :**
Accédez à **SQL** dans la console GCP. Recherchez l'instance nommée `app-sql-<deployment_id>`. Cliquez sur l'instance pour afficher :
- **Vue d'ensemble** — nom de connexion, région, version de PostgreSQL, utilisation du stockage.
- **Bases de données** — la base de données `umami`.
- **Utilisateurs** — l'utilisateur de l'application `umami`.
- **Connexions** — connexions actives depuis le service Cloud Run via Auth Proxy.
- **Sauvegardes** — calendrier de sauvegarde automatisé et points de restauration.

**Secret Manager :**
Accédez à **Sécurité → Secret Manager**. Recherchez les secrets nommés `secret-<tenant_resource_prefix>-<application_name>-app-secret` (ou similaire). Cliquez sur un secret pour afficher :
- Versions du secret et horodatages de création.
- Entrées du journal d'accès montrant quand Cloud Run a lu le secret.
- Politique de réplication.

**Artifact Registry :**
Accédez à **Artifact Registry**. Recherchez le dépôt pour ce déploiement. Cliquez pour afficher les images Umami mises en miroir, leurs tags, leurs tailles et l'état de la politique de rétention.

**Vérifications de la disponibilité de Cloud Monitoring :**
Si `uptime_check_config.enabled = true` a été défini, accédez à **Surveillance → Vérifications de la disponibilité** et recherchez la vérification pour ce déploiement Umami ciblant `/api/heartbeat`. Affichez les résultats de la vérification, le temps de réponse et l'historique des échecs dans les régions GCP.

### E. Exploration avec gcloud {#e-exploring-with-gcloud}

Utilisez ces commandes gcloud pour inspecter le déploiement Umami depuis la ligne de commande. Remplacez `PROJECT_ID`, `REGION` et `DEPLOYMENT_ID` par vos valeurs.

```bash
# List Cloud Run services in the project
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,status.url,status.conditions[0].type)"

# Describe the Umami Cloud Run service
gcloud run services describe SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION \
  --format="yaml(status.url,spec.template.spec.containers[0].resources)"

# View the latest revision
gcloud run revisions list \
  --project=PROJECT_ID \
  --region=REGION \
  --service=SERVICE_NAME \
  --format="table(name,status.conditions[0].type,spec.containerConcurrency,metadata.creationTimestamp)"

# Tail Cloud Run logs
gcloud run services logs tail SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION

# Check Cloud SQL instance status
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion,settings.tier)"

# List databases in the Cloud SQL instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List Cloud SQL users
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List Secret Manager secrets for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~umami" \
  --format="table(name,createTime,replication.auto)"

# Describe the APP_SECRET secret
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID

# View uptime check results (Cloud Monitoring)
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"

# List Artifact Registry images for Umami
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)"

# Check Cloud Run IAM policy
gcloud run services get-iam-policy SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION

# View Cloud Build triggers for this deployment
gcloud builds triggers list \
  --project=PROJECT_ID \
  --filter="name~umami" \
  --format="table(name,createTime,github.push.branch)"
```

---

## 9. Comportements gérés par la plateforme {#9-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Umami CloudRun`, quelles que soient les valeurs des variables. Ils ne peuvent pas être outrepassés via `tfvars`.

| Comportement | Implémentation | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | Valeur par défaut de `database_type = "POSTGRES_15"` | Umami requiert PostgreSQL. MySQL et les autres moteurs ne sont pas pris en charge. |
| **DATABASE_URL construit à l'exécution** | Point d'entrée personnalisé dans l'image `Umami Common` | Le mode d'image `custom` construit un wrapper qui assemble `DATABASE_URL` à partir des variables DB_* injectées par la plateforme. L'utilisation du mode `prebuilt` requiert une configuration manuelle de `DATABASE_URL`. |
| **APP_SECRET auto-généré** | `random_password` dans `Umami Common` | Secret alphanumérique de 32 caractères, stocké dans Secret Manager, injecté comme `APP_SECRET`. |
| **Pas de buckets de stockage par défaut** | Valeur par défaut de `storage_buckets = []` | Umami est sans état — aucun bucket GCS n'est provisionné sauf configuration explicite. |
| **Mise en miroir des images activée par défaut** | `enable_image_mirroring = true` | Met en miroir depuis GitHub Container Registry (`ghcr.io`) vers Artifact Registry pour éviter les limites de débit. |
| **Job db-init par défaut** | Fourni par `Umami Common` lorsque `initialization_jobs = []` | La base de données et l'utilisateur PostgreSQL sont créés automatiquement avant qu'Umami n'exécute ses propres migrations. |
| **Migrations Prisma au démarrage** | Comportement du conteneur Umami | Umami exécute ses propres migrations de base de données Prisma à chaque démarrage. Le job `db-init` ne fait que pré-créer la base de données et l'utilisateur. |
| **Pas de Redis requis** | Valeur par défaut de `enable_redis = false` | Umami utilise uniquement PostgreSQL pour tout le stockage de données. Redis n'est pas requis. |
| **Répertoire des scripts** | `scripts_dir = abspath("${module.umami_app.path}/scripts")` | Les scripts d'initialisation proviennent de `Umami Common`, et non du répertoire de déploiement. |

L'**infrastructure intégrée** (lorsqu'aucune pile `Services_GCP` n'est présente) est identique à `App_CloudRun` §9 — `App_CloudRun` provisionne un VPC intégré, Cloud NAT, une instance Cloud SQL, des comptes de service et les API GCP selon les besoins. Voir [App_CloudRun](./App_CloudRun.md#dependency-on-services-gcp-for-shared-resources) pour l'inventaire complet des ressources intégrées et les notes de suppression.

---

## 10. Référence des variables {#10-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Umami CloudRun`, triées par groupe d'interface utilisateur puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `resource_creator_identity` | 0 | (SA de la plateforme) | Compte de service utilisé par Terraform pour gérer les ressources. |
| `project_id` | 1 | — | ID du projet GCP. **Requis.** |
| `region` | 1 | `'us-central1'` | Région GCP pour toutes les ressources. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'umami'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `application_display_name` | 3 | `'Umami'` | Nom lisible par l'homme affiché dans la console GCP. |
| `application_description` | 3 | `'Umami Analytics on Cloud Run'` | Description du service. |
| `application_version` | 3 | `'postgresql-latest'` | Tag de l'image conteneur Umami. Utilisez les tags préfixés `postgresql-`. |
| `deploy_application` | 4 | `true` | Définir `false` pour un déploiement uniquement d'infrastructure. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) ou `'prebuilt'` (image existante). |
| `container_image` | 4 | `'ghcr.io/umami-software/umami'` | URI de l'image conteneur. |
| `container_build_config` | 4 | `{ enabled=true }` | Configuration Cloud Build pour les builds d'images personnalisées. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Umami dans Artifact Registry. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. |
| `min_instance_count` | 4 | `0` | Instances minimales (0 = mise à l'échelle à zéro). |
| `max_instance_count` | 4 | `3` | Instances maximales. |
| `container_port` | 4 | `3000` | Port natif d'Umami. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `execution_environment` | 4 | `'gen2'` | Génération de l'environnement d'exécution Cloud Run. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes par défaut. Définir `true` pour allouer le CPU en permanence. |
| `enable_cloudsql_volume` | 4 | `true` | Monte l'instance Cloud SQL via l'intégration native du socket Cloud Run (pas de sidecar Auth Proxy sur Cloud Run). |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket Unix Cloud SQL. |
| `traffic_split` | 4 | `[]` | Allocation de trafic Canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/SA ayant accès à IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès à IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair (par exemple, `{ DISABLE_TELEMETRY = "1" }`). |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` ou `'gdrive'`. |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde à importer. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur Cloud Build GitHub. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image lors du déploiement. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | Mode d'application de l'autorisation binaire. Non référencé dans ce module. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images conteneurs à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Contrôle le provisionnement des buckets GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS à provisionner. Vide par défaut — Umami n'a pas besoin de stockage de fichiers. |
| `enable_nfs` | 11 | `false` | Provisionne un stockage partagé NFS. Non requis pour Umami. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin de montage NFS du conteneur. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK pour les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Doit être `POSTGRES_15` pour Umami. |
| `application_database_name` | 12 | `'umami'` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `application_database_user` | 12 | `'umami'` | Utilisateur de l'application PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `enable_postgres_extensions` | 12 | `false` | Active l'installation d'extensions PostgreSQL. |
| `postgres_extensions` | 12 | `[]` | Extensions PostgreSQL à installer. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laisser vide pour que `Umami Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run récurrents planifiés. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés avec Umami. |
| `startup_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=30 }` | Sonde de démarrage. |
| `liveness_probe` | 14 | `{ path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=3 }` | Sonde de vivacité. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de démarrage Cloud Run (passée directement à `App CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/heartbeat" }` | Sonde de vivacité Cloud Run (passée directement à `App CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/heartbeat" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |
| `enable_redis` | 16 | `false` | Active l'injection de variables d'environnement Redis. Non requis pour Umami. |
| `redis_host` | 16 | `""` | Nom d'hôte/IP Redis. Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | 16 | `'6379'` | Port TCP Redis (chaîne). |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR du sous-réseau VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Enregistre les violations VPC-SC sans les bloquer. |
| `organization_id` | 22 | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement à partir du projet si vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés. |

---

## 11. Sorties {#11-outputs}

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
| `container_image` | Image conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(requis)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Umami ne prend en charge que PostgreSQL. La définition de MySQL ou d'un autre moteur rompra la construction `DATABASE_URL` et entraînera l'échec d'Umami au démarrage avec une erreur de connexion à la base de données. |
| `application_database_name` | `"umami"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur entraîne la recréation de la base de données par Terraform, détruisant toutes les données analytiques collectées par Umami. |
| `application_database_user` | `"umami"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur recrée l'utilisateur Cloud SQL, invalidant toutes les informations d'identification stockées et rompant la connexion de la base de données d'Umami. |
| `container_port` | `3000` | **Critique** | Umami écoute sur le port 3000. La modification de cette valeur sans faire correspondre le port lié du conteneur entraîne l'échec des sondes de santé Cloud Run et le service est marqué comme non sain. |
| `container_image_source` | `"custom"` | **Élevé** | Le mode `custom` construit une image wrapper qui assemble `DATABASE_URL` à partir des variables DB_*. L'utilisation de `"prebuilt"` avec l'image officielle d'Umami nécessite de fournir manuellement `DATABASE_URL` comme variable d'environnement — sans cela, Umami ne peut pas se connecter à PostgreSQL et plantera au démarrage. |
| `application_version` | `"postgresql-latest"` | **Moyen** | Utilisez toujours un tag préfixé `postgresql-` (par exemple, `postgresql-latest`, `postgresql-v2.11.3`). Les tags de version simples (par exemple, `latest`) ne sont pas publiés pour la variante PostgreSQL d'Umami et entraîneront une erreur de pull de conteneur. |
| `admin_password` | _(changer lors de la première connexion)_ | **Critique** | Les identifiants d'administrateur Umami par défaut sont `admin` / `umami` — largement connus. Le fait de ne pas les changer lors de la première connexion expose votre tableau de bord analytique et toutes les données suivies à quiconque connaît l'URL. |
| `enable_iap` | `false` | **Moyen** | Sans IAP, toute personne connaissant l'URL Cloud Run peut accéder à la page de connexion du tableau de bord Umami. L'authentification propre à Umami est la seule barrière. Activez IAP ou assurez-vous que `ingress_settings = "internal"` pour les déploiements privés. |
| `ingress_settings` | `"all"` | **Moyen** | `"all"` expose Umami publiquement. Le point de terminaison du script de suivi doit être publiquement accessible pour que les sites web suivis puissent rapporter des données, mais le tableau de bord d'administration doit être restreint pour les déploiements sensibles. Envisagez d'utiliser IAP ou un domaine personnalisé avec un accès restreint pour les chemins d'administration. |
| `min_instance_count` | `0` | **Faible** | La mise à l'échelle à zéro est sûre pour Umami — les démarrages à froid sont rapides (quelques secondes). Cependant, la première requête après un démarrage à froid subira une légère latence. Définissez sur `1` pour les tableaux de bord analytiques sensibles au temps. |
| `memory_limit` | `"512Mi"` | **Moyen** | 512 Mio est la valeur par défaut et est suffisante pour un trafic modéré. Les sites à fort trafic avec de nombreux utilisateurs de tableau de bord simultanés ou des requêtes complexes peuvent rencontrer des problèmes de mémoire insuffisante. Augmentez à `1Gi` si vous observez une pression mémoire dans Cloud Monitoring. |
| `enable_backup_import` | `false` | **Critique** | Nécessite qu'un fichier de sauvegarde valide soit accessible à `backup_file`. L'activation avec un chemin invalide entraîne l'échec du job Cloud Run de restauration lors de l'apply. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours est le minimum pour l'analyse de production. La perte de l'historique analytique a un impact commercial direct. Augmentez à 30 jours et plus pour tout déploiement analytique à long terme. |
| `secret_propagation_delay` | `30` | **Faible** | Parfois insuffisant dans les configurations multi-régions. Augmentez à 60–90s si des erreurs de lecture de secret sont observées lors de l'apply. |
| `enable_cloudsql_volume` | `true` | **Critique** | Sur Cloud Run, cela monte l'intégration native du socket Cloud SQL — il n'y a pas de sidecar Auth Proxy et pas de listener TCP `127.0.0.1:5432` (cela n'existe que sur GKE). Le point d'entrée partagé `Umami_Common` (`umami-entrypoint.sh`) résout inconditionnellement un chemin de socket `DB_HOST` vers `127.0.0.1` avant de construire `DATABASE_URL`, ce qui n'est valide que sur GKE — sur Cloud Run, cela produit `ECONNREFUSED 127.0.0.1:5432` dans les journaux de révision et la sonde de démarrage échoue. Si Umami ne démarre pas, vérifiez les `DB_HOST`/`DB_IP` injectés de la révision déployée (`gcloud run revisions describe … --format=json`) plutôt que de supposer que la substitution de bouclage fonctionne. |
| `vpc_sc_dry_run` | `true` | **Moyen** | L'exécution à sec de VPC-SC enregistre les violations mais ne les bloque pas. Après avoir vérifié l'absence de faux positifs dans Cloud Logging, passez à `false` pour une application réelle. Laisser en `true` en permanence n'offre aucun avantage en matière de sécurité. |

---

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : Libération d'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run. Terraform/OpenTofu ne peut pas terminer la suppression du sous-réseau ou du VPC tant qu'elles ne sont pas entièrement libérées.

**Résolution :** Attendez 20 à 30 minutes après la première tentative de destruction, puis réexécutez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Umami sur Cloud Run](../labs/Umami_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Module Umami GKE — Guide de configuration](Umami_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Umami](Umami_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Directus sur Cloud Run](Directus_CloudRun.md) dans la solution **Plateforme de contenu headless**.
