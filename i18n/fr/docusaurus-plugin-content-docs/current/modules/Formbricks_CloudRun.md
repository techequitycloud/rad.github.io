---
title: "Formbricks sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Formbricks sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Formbricks_CloudRun.md @ e69407af sha256:5fae4360716a -->

# Formbricks sur Google Cloud Run {#formbricks-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Formbricks_CloudRun.png" alt="Formbricks sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module `modules/Formbricks_CloudRun`. Il couvre l'architecture, IAM, les variables de configuration, les comportements spécifiques à Formbricks et les modèles opérationnels pour le déploiement de Formbricks sur Google Cloud Run (v2).

---

## Ce que coûte Formbricks sur RAD, et comment cela se compare {#what-formbricks-costs-on-rad-and-how-that-compares}

**L'exécution de Formbricks dans votre propre projet Google Cloud coûte environ 83,61 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique de 110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD). Formbricks est une plateforme open source de gestion d'enquêtes et d'expériences. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Formbricks est également disponible sur GKE — consultez le [guide GKE](Formbricks_GKE.md) si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre l'option Cloud Run, moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une fois) | **99 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~83,61 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~32 crédits/jour (~3,20 $ US/jour), facturé à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **83,61 $ US** |

### Comment cela se compare {#how-it-compares}

- Le plan payant le moins cher de **Formbricks Cloud**, Pro, est de 74 $ US/mois (3 espaces de travail, 2 000 réponses mensuelles, sièges illimités) — vérifié sur [https://formbricks.com/pricing](https://formbricks.com/pricing). Cela est inférieur à la facture Google Cloud de RAD d'environ 83,61 $ US/mois pour la variante Cloud Run sur le seul prix affiché, mais cela plafonne l'utilisation ; l'instance de RAD est illimitée, auto-hébergée, et les données ne quittent jamais votre propre projet.
- Le véritable compromis ici est entre le plafond et le contrôle, pas le prix : un plan SaaS géré est moins cher à cette échelle, et le coût d'exécution de RAD est ce que coûtent réellement Cloud SQL, le calcul et le réseau au prix catalogue de Google, sans rien de caché dans un prix de siège groupé.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes monétaires — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Formbricks est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression du module Formbricks seul, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne typique de 2 à 3 déploiements. Les frais de module de 99 crédits ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour lequel RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Formbricks et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Formbricks est dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou **99 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Formbricks devait rester inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution : environ **5 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 83,61 $ US/mois), ou **environ 4 jours ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~32 crédits/jour).

La majeure partie du coût d'exécution de Formbricks est la base de données et la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la part de calcul de cette application sur le total ci-dessus.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [tarification de Formbricks Cloud](https://formbricks.com/pricing) pour les chiffres de Formbricks Cloud.

## 1. Vue d'ensemble du module {#1-module-overview}

Formbricks est une plateforme open source de gestion d'enquêtes et d'expériences. Elle permet aux équipes de créer des enquêtes produit, des enquêtes NPS, des flux d'intégration et des widgets de feedback in-app à partir d'une seule plateforme. Basée sur Next.js avec Prisma ORM, elle nécessite PostgreSQL, Redis en option et un stockage d'objets compatible S3. `Formbricks CloudRun` est un **module wrapper** construit au-dessus de `App CloudRun`. Il utilise `App CloudRun` pour toutes les provisions d'infrastructure GCP et injecte la configuration d'application spécifique à Formbricks, les secrets, l'initialisation de la base de données et le stockage compatible S3 basé sur GCS via `Formbricks Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Next.js sur le port 3000, 1 vCPU / 2 Gio par défaut (2 vCPU / 2 Gio recommandés pour la production). Mise à l'échelle à zéro (`min_instance_count = 0`) avec `max_instance_count = 1`.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. NFS (VM GCE ou Filestore) activé par défaut. Un bucket GCS `uploads` est automatiquement provisionné par `Formbricks Common` pour le stockage de fichiers compatible S3 via les identifiants HMAC GCS.
*   **Sécurité** : Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`. Plusieurs secrets d'application auto-générés (clé NextAuth, clé de chiffrement, jeton cron, clés HMAC) sont provisionnés dans Secret Manager par `Formbricks Common`.
*   **Mise en cache** : Redis **activé par défaut** (`enable_redis = true`) — Formbricks utilise Redis pour la mise en cache et les files d'attente de tâches en arrière-plan.
*   **CI/CD** : Pipeline d'images personnalisées Cloud Build par défaut ; livraison progressive Cloud Deploy en option.
*   **Sondes de santé** : La sonde de démarrage est **TCP** sur le port du conteneur par conception, pas HTTP `/api/v2/health` — ce point de terminaison ne renvoie 2xx qu'une fois que Formbricks signale une pleine disponibilité (DB + Redis + dépendances), de sorte qu'une sonde de démarrage HTTP ne passe jamais même si Next.js écoute déjà ("Ready" dans les journaux, mais le service n'est jamais créé). La sonde de vivacité est **désactivée par défaut** pour la même raison : la vivacité de Cloud Run ne peut pas utiliser un socket TCP, et le point de terminaison HTTP `/api/v2/health` redémarrerait en boucle un conteneur sain avant qu'il n'atteigne sa pleine disponibilité. La sonde de démarrage TCP seule gère le routage.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des e-mails pour les alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Étiquettes appliquées à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'formbricks'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Formbricks Surveys'` | Nom lisible par l'homme affiché dans la console GCP. |
| `description` | 3 | `string` | `'Formbricks - Open Source Survey and Experience Management'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'latest'` | Balise de version de l'image Formbricks. Incrémenter pour déployer une nouvelle version. |
| `webapp_url` | 3 | `string` | `""` | URL publique de l'instance Formbricks. Définie après le premier déploiement. |

**Architecture du wrapper :** `Formbricks CloudRun` appelle `Formbricks Common` pour construire un objet `application_config` contenant les variables d'environnement spécifiques à Formbricks, les secrets auto-générés, le câblage de stockage S3/GCS, la configuration des sondes et la définition de tâche `db-init`. `module_storage_buckets` contient le bucket `uploads` provisionné par `Formbricks Common`. `scripts_dir` est résolu au répertoire `Formbricks_Common/scripts` au moment de l'apply.

**Note sur l'URL de l'application web :** Lorsque `webapp_url` est laissé vide, `main.tf` calcule une URL de service Cloud Run déterministe (`https://<service>-<project-number>.<region>.run.app`) et la transmet à `Formbricks Common` comme `WEBAPP_URL`/`NEXTAUTH_URL` — Formbricks ne revient jamais réellement à la valeur par défaut `localhost:3000` de l'image sur Cloud Run (Cloud Run n'interpole pas les références `$(VAR)`, donc l'URL est calculée comme une chaîne de caractères simple). Définissez `webapp_url` explicitement uniquement pour pointer les rappels OAuth et les liens e-mail vers un domaine personnalisé au lieu de l'URL `run.app` prédite.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Formbricks_CloudRun` délègue toutes les provisions IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation de mot de passe sont identiques à ceux du module App_CloudRun.

**Secrets d'application auto-générés :** Contrairement à Ghost, `Formbricks Common` auto-génère plusieurs secrets au niveau de l'application et les stocke dans Secret Manager. Ceux-ci sont créés une fois et restent stables entre les déploiements :

| Secret | Variable d'environnement | Notes |
|---|---|---|
| `NEXTAUTH_SECRET` | `NEXTAUTH_SECRET` | Clé de chiffrement de session NextAuth.js (aléatoire de 32 caractères). |
| `ENCRYPTION_KEY` | `ENCRYPTION_KEY` | Clé de chiffrement des données Formbricks. |
| `CRON_SECRET` | `CRON_SECRET` | Jeton d'authentification de la tâche Cron. |
| `HUB_API_KEY` | `HUB_API_KEY` | Clé API Formbricks Hub. |
| `CUBEJS_API_SECRET` | `CUBEJS_API_SECRET` | Secret d'analyse Cube.js. |
| `S3_ACCESS_KEY` | `S3_ACCESS_KEY` | Clé d'accès HMAC GCS pour les téléchargements compatibles S3. |
| `S3_SECRET_KEY` | `S3_SECRET_KEY` | Clé secrète HMAC GCS pour les téléchargements compatibles S3. |
| `SMTP_PASSWORD` | `SMTP_PASSWORD` | Créé uniquement lorsque `smtp_host` est configuré. |
| `REDIS_URL` | `REDIS_URL` | Créé uniquement lorsque Redis est activé avec l'authentification. |

Les secrets `DB_PASSWORD` et `ROOT_PASSWORD` sont provisionnés automatiquement par `App CloudRun` et consommés par la tâche `db-init`.

**Accès à Secret Manager :** Le compte de service Cloud Run se voit accorder `roles/secretmanager.secretAccessor` sur tous les secrets provisionnés. Les valeurs en texte clair ne sont jamais écrites dans l'état du déploiement.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Formbricks est une application Next.js qui effectue des migrations de base de données Prisma au démarrage. `Formbricks CloudRun` expose `cpu_limit` et `memory_limit` comme variables de niveau supérieur avec des valeurs par défaut judicieuses.

**La mise à l'échelle à zéro est activée** (`min_instance_count = 0` par défaut). Les démarrages à froid de Formbricks prennent généralement 15 à 20 secondes, car Next.js compile et Prisma valide sa connexion à la base de données. Pour les enquêtes de production avec des exigences de SLA, définissez `min_instance_count = 1` pour éliminer les démarrages à froid.

**Le boost CPU au démarrage** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` par défaut à `'custom'`, ce qui signifie que Cloud Build construit une image personnalisée à l'aide du Dockerfile de `Formbricks_Common` (en encapsulant `ghcr.io/formbricks/formbricks`). Définissez `container_image_source = 'prebuilt'` et `container_image = 'ghcr.io/formbricks/formbricks:latest'` pour ignorer la construction et déployer directement en amont.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure (SQL, stockage, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` construit via Cloud Build. `'prebuilt'` déploie une URI d'image existante. |
| `container_image` | 4 | `""` | Remplace l'URI de l'image. Laissez vide pour que Cloud Build gère l'image. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. 1 vCPU minimum ; `'2000m'` recommandé pour la production. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gio par défaut ; ne pas définir en dessous de 512 Mio. |
| `container_port` | 4 | `3000` | Port HTTP natif de Formbricks. Ne pas modifier. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. Augmenter pour les téléchargements de fichiers volumineux. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le volume du socket Unix du proxy d'authentification Cloud SQL. Par défaut à `true` : une connexion TCP IP directe force `sslmode=require`, et le client `pg` de Formbricks/Prisma vérifie le certificat Cloud SQL IP privée, ce qui échoue contre son CA non fiable (chaque requête 500s). Le socket évite cela — le proxy fait le mTLS et l'application se connecte avec `sslmode=disable`. |
| `traffic_split` | 4 | `[]` | Allocation de trafic canari/bleu-vert basée sur un pourcentage. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Étiquettes appliquées au service Cloud Run. |
| `min_instance_count` | 4 | `0` | Instances en cours d'exécution minimales. Définir à `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances concurrentes. Augmenter pour les déploiements à trafic plus élevé. |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes par défaut : Formbricks sert les enquêtes/tableaux de bord sur demande, et son pipeline de réponse (e-mails de notification, webhooks, intégrations) ne s'exécute qu'après une réponse à l'enquête. Définissez `true` si vous exécutez des enquêtes en direct qui nécessitent des notifications/webhooks en temps réel livrés sans attendre la prochaine requête pour réveiller l'instance. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Formbricks CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `3000` | Le serveur Next.js de Formbricks se lie au port 3000. |
| `cpu_limit` | `'1000m'` | `'1000m'` | Même valeur par défaut — mise à niveau vers `'2000m'` pour la production. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Next.js + Prisma + rendu d'enquête nécessite beaucoup plus de RAM. |
| `enable_image_mirroring` | `false` | `true` | Formbricks se met en miroir sur Artifact Registry pour éviter les limites de débit de ghcr.io. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Formbricks nécessite PostgreSQL. `Formbricks Common` corrige `database_type = "POSTGRES_15"`. Le module utilise `db_name` et `db_user` comme variables raccourcies spécifiques à Formbricks.

**Connexion par socket Unix :** `enable_cloudsql_volume` par défaut à `true`. Formbricks se connecte à Cloud SQL PostgreSQL via le socket Unix du proxy d'authentification Cloud SQL (monté à `cloudsql_volume_mount_path`, par défaut `/cloudsql`), injecté comme `DB_HOST`. Cela évite un échec de vérification de certificat qui se produit lorsque le client `pg` de Formbricks/Prisma se connecte directement via TCP IP privée avec `sslmode=require` contre l'autorité de certification non fiable de Cloud SQL. Définissez `enable_cloudsql_volume = false` uniquement pour une connexion TCP IP directe qui présente un certificat vérifiable.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `db_name` | 12 | `'formbricks'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `db_user` | 12 | `'formbricks'` | Utilisateur de l'application PostgreSQL. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `sql_instance_name` | 12 | `""` | Nom d'une instance Cloud SQL existante. Laissez vide pour une découverte automatique. |
| `sql_instance_base_name` | 12 | `'app-sql'` | Nom de base pour une instance Cloud SQL intégrée. L'ID de déploiement est ajouté. |

> `database_type` est fixé à `"POSTGRES_15"` par `Formbricks Common` et n'est pas modifiable par l'utilisateur via la variable standard `database_type`. Formbricks nécessite PostgreSQL et ne démarrera pas avec MySQL ou SQL Server.

### C. Stockage (NFS et GCS) {#c-storage-nfs--gcs}

**NFS est activé par défaut** (`enable_nfs = true`). Formbricks stocke les fichiers partagés sur le volume NFS lorsque plusieurs instances sont actives. Nécessite `execution_environment = 'gen2'`.

**Bucket de téléchargement GCS :** `Formbricks Common` provisionne automatiquement un bucket GCS `uploads` dédié et configure Formbricks pour utiliser l'API XML compatible S3 de GCS via des identifiants HMAC. Le nom du bucket est injecté comme `S3_BUCKET_NAME`, et `S3_ENDPOINT_URL=https://storage.googleapis.com` achemine le client S3 de Formbricks vers GCS. Ce bucket est distinct de tous les buckets listés dans `storage_buckets`.

**Injection de clé HMAC :** `S3_ACCESS_KEY` et `S3_SECRET_KEY` sont des identifiants HMAC GCS auto-générés stockés dans Secret Manager et injectés comme variables d'environnement secrètes au moment de l'exécution.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisionne un volume NFS pour le stockage de fichiers partagés. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où le partage NFS est monté. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création de buckets supplémentaires. Le bucket `uploads` est toujours provisionné. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket de téléchargement auto-provisionné. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour une découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base pour une VM GCE NFS intégrée. L'ID de déploiement est ajouté. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés CMEK KMS et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

Cloud Run utilise Direct VPC Egress pour atteindre Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, Formbricks se connecte à PostgreSQL via le socket Unix du proxy d'authentification Cloud SQL plutôt que par une connexion TCP directe à l'IP privée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic via le LB HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est automatiquement provisionné par `Formbricks Common` lorsque `initialization_jobs` est laissé comme liste vide par défaut. Il utilise une image compatible PostgreSQL et exécute `Formbricks_Common/scripts/db-init.sh`, qui effectue une création de base de données et d'utilisateur idempotente avant le démarrage du service Formbricks.

**Les migrations Prisma** sont gérées par Formbricks lui-même au démarrage du conteneur (`PRISMA_MIGRATE=false` est défini pour désactiver la migration forcée, car Formbricks exécute sa propre logique de migration Prisma au démarrage).

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Formbricks Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau, adresses IP de sortie CI/CD). |

### B. Proxy conscient de l'identité (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. L'authentification d'identité Google est requise avant que les requêtes n'atteignent Formbricks. Utile pour les déploiements internes ou les environnements d'enquête de staging.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

### C. Autorisation binaire {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run impose que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image. Nécessite une politique d'autorisation binaire préconfigurée dans le projet. |

### D. Contrôles de service VPC {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont liés à un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets d'application Formbricks sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état.

`Formbricks Common` auto-génère tous les secrets d'application requis. Des secrets définis par l'utilisateur peuvent être ajoutés via `secret_environment_variables` pour les mots de passe SMTP et d'autres valeurs sensibles personnalisées.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappage du nom de la variable d'environnement → ID du secret Secret Manager. Résolu au moment de l'exécution. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne continuent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global soutenu par un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

La définition de `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Formbricks à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS. Formbricks sert un mélange de pages rendues côté serveur Next.js et d'actifs statiques. Le CDN est bien adapté aux actifs statiques (bundles JS, CSS, images d'enquête téléchargées), mais les soumissions d'enquête et les points de terminaison d'API ne doivent pas être mis en cache.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. N'est efficace que lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées (pendantes) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont attachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'adresse IP de l'équilibreur de charge après l'application.

Après avoir défini un domaine personnalisé, mettez à jour `webapp_url` pour qu'il corresponde — NextAuth.js utilise cette valeur pour les URI de redirection OAuth et les liens e-mail.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Certificats SSL gérés par Google provisionnés par domaine. |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés. Le déclencheur construit et déploie une image Formbricks personnalisée lorsque du code est poussé vers la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. Nécessite `github_repository_url` et des identifiants. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (étendues `repo`, `admin:repo_hook`). Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (préféré pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est mis à niveau vers un pipeline de livraison Cloud Deploy géré avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chaque : `name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` et `max_instance_count = 1` sont les valeurs par défaut. Les démarrages à froid de Formbricks prennent 15 à 20 secondes en raison de l'initialisation de Next.js et de la configuration de la connexion Prisma. Pour les déploiements de production, définissez `min_instance_count = 1`.

Lorsque Redis est activé (`enable_redis = true`), plusieurs instances Formbricks peuvent partager l'état du cache, ce qui rend la mise à l'échelle horizontale sûre. Augmentez `max_instance_count` pour les périodes d'enquête à fort trafic.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge. Étant donné que Formbricks externalise l'état de session vers PostgreSQL et l'état du cache vers Redis, les déploiements canaris sont sûrs — les requêtes sont acheminées de manière cohérente, quelle que soit l'instance qui les gère.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Allocation de trafic basée sur un pourcentage entre les révisions nommées. Toutes les entrées doivent totaliser 100. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Formbricks expose `/api/v2/health` — un point de terminaison de santé dédié qui renvoie `HTTP 200` uniquement une fois que l'application ET ses dépendances de base de données/Redis signalent une pleine disponibilité. En raison de cette sémantique de "pleine disponibilité", les sondes ne ciblent délibérément **pas** les deux comme une vérification HTTP :

- **`startup_probe` par défaut à TCP**, pas HTTP `/api/v2/health` : une sonde HTTP contre ce chemin ne passe jamais tant que la pleine disponibilité n'est pas atteinte, de sorte que la sonde de démarrage de Cloud Run ne réussirait jamais même si Next.js écoute déjà sur le port du conteneur ("Ready" dans les journaux, mais le service ne devient jamais routable). Une sonde TCP réussit dès que l'application lie le port — la bonne porte pour "acheminer le trafic ici".
- **`liveness_probe` est désactivé par défaut** (`enabled = false`) : les sondes de vivacité de Cloud Run ne peuvent pas utiliser un socket TCP, et le chemin HTTP `/api/v2/health` redémarrerait en boucle un conteneur par ailleurs sain avant qu'il n'atteigne sa pleine disponibilité. La sonde de démarrage TCP gère déjà le trafic, donc la vivacité est désactivée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="TCP", path="/api/v2/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=20, failure_threshold=10 }` | Sonde de disponibilité au démarrage. **TCP par conception** — voir l'explication ci-dessus. Le conteneur ne reçoit aucun trafic tant que cela ne réussit pas. |
| `liveness_probe` | 14 | `{ enabled=false, type="HTTP", path="/api/v2/health", initial_delay_seconds=15, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. **Désactivée par défaut** — voir l'explication ci-dessus. N'activez que si vous comprenez le risque de boucle de redémarrage contre `/api/v2/health` avant la pleine disponibilité. |
| `startup_probe_config` | 14 | `{ enabled=true, type="TCP" }` | Sonde de démarrage de service au niveau App_CloudRun, indépendante de la sonde `startup_probe` spécifique à Formbricks ci-dessus. |
| `health_check_config` | 14 | `{ enabled=true, type="HTTP", path="/" }` | Sonde de vivacité de service au niveau App_CloudRun, indépendante de la sonde `liveness_probe` spécifique à Formbricks ci-dessus. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Vérification de la disponibilité de Cloud Monitoring. Désactivée par défaut ; activez pour la surveillance de production — les alertes notifient `support_users` si inaccessible. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique de Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche une tâche de rotation Cloud Run.
3. La tâche génère un nouveau mot de passe, met à jour l'utilisateur PostgreSQL de Cloud SQL, écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, la tâche redémarre le service Formbricks.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après l'écriture du nouveau secret avant de redémarrer le service. |

---

## 8. Intégrations {#8-integrations}

### A. Cache Redis {#a-redis-cache}

Redis est **activé par défaut** (`enable_redis = true`). Formbricks utilise Redis pour mettre en cache les réponses API, limiter le débit et gérer les files d'attente des tâches en arrière-plan. Lorsque Redis est activé et que `redis_host` n'est pas fourni, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis (une instance Redis légère co-localisée sur la VM GCE NFS). Pour les déploiements de production, pointez `redis_host` vers une instance Google Cloud Memorystore for Redis dédiée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | Active Redis pour la mise en cache et la limitation de débit de Formbricks. Recommandé pour tous les déploiements. |
| `redis_host` | 21 | `""` | Nom d'hôte ou adresse IP du serveur Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe d'authentification Redis. Sensible — jamais stocké dans l'état. |

### B. E-mail (SMTP) {#b-email-smtp}

Formbricks utilise SMTP pour les e-mails transactionnels : invitations d'utilisateurs, notifications de réponses aux sondages et e-mails d'intégration. Les variables SMTP dédiées offrent une interface plus propre que `environment_variables` :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `smtp_host` | 5 | `'smtp.gmail.com'` | Nom d'hôte du serveur SMTP. Définissez sur `""` pour désactiver les e-mails. |
| `smtp_port` | 5 | `587` | Port SMTP. Utilisez 587 pour STARTTLS (recommandé) ou 465 pour TLS implicite. |
| `smtp_user` | 5 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | 5 | `""` | Mot de passe SMTP. Généré automatiquement et stocké dans Secret Manager si laissé vide. Sensible. |
| `smtp_secure_enabled` | 5 | `false` | Active le TLS implicite. Définissez `true` lorsque `smtp_port = 465`. |
| `mail_from` | 5 | `""` | Adresse de l'expéditeur affichée dans les e-mails Formbricks (par exemple, `'noreply@surveys.example.com'`). |

### C. Formbricks Hub et Cube.js {#c-formbricks-hub--cubejs}

À partir de Formbricks v5, la plateforme se connecte à un service Formbricks Hub pour la gestion des licences et l'analyse, et à un sidecar Cube.js pour les requêtes d'analyse.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `hub_api_url` | 21 | `'http://localhost:8080'` | URL de l'API Formbricks Hub. À remplacer lors de l'exécution de Hub en tant que service Cloud Run distinct. |
| `cubejs_api_url` | 21 | `'http://localhost:4000'` | URL de l'API d'analyse Cube.js. À remplacer pour un déploiement Cube.js distinct. |

### D. Importation et récupération de sauvegarde {#d-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL PostgreSQL provisionnée pendant l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Définissez `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complet (par exemple, `'gs://my-bucket/formbricks-2024.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

---

## 9. Comportements gérés par la plateforme {#9-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Formbricks CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Implémentation | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | `database_type = "POSTGRES_15"` corrigé par `Formbricks Common` | Formbricks nécessite PostgreSQL. MySQL et SQL Server ne sont pas pris en charge. |
| **Stockage compatible S3 via GCS** | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT_URL=https://storage.googleapis.com` injectés automatiquement | Le client de téléchargement de fichiers S3 de Formbricks est pointé vers GCS via l'API XML. Les identifiants HMAC dans Secret Manager authentifient la connexion. |
| **Bucket de téléchargement GCS** | Bucket `uploads` provisionné par `Formbricks Common` via `module_storage_buckets` | Un bucket GCS dédié aux téléchargements de fichiers Formbricks est provisionné séparément de `storage_buckets`. |
| **Secrets auto-générés** | `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Tous les secrets au niveau de l'application sont créés une seule fois par `Formbricks Common` et restent stables. |
| **NFS activé par défaut** | Valeur par défaut `enable_nfs = true` | Le stockage NFS partagé est provisionné. Nécessite `execution_environment = 'gen2'`. |
| **Redis activé par défaut** | Valeur par défaut `enable_redis = true` | La mise en cache Redis est activée par défaut. Lorsque `redis_host` est vide, l'adresse IP du serveur NFS est utilisée. |
| **Mise en miroir des images** | Valeur par défaut `enable_image_mirroring = true` | Les images Formbricks sont mises en miroir de `ghcr.io` vers Artifact Registry pour éviter les limites de débit. |
| **Connexion à la base de données via socket Unix** | Valeur par défaut `enable_cloudsql_volume = true` | Formbricks se connecte à PostgreSQL via le socket Unix du proxy d'authentification Cloud SQL plutôt que via TCP direct-IP, évitant ainsi un échec de vérification de certificat Prisma contre l'autorité de certification non fiable de Cloud SQL. |
| **Sonde de démarrage TCP** | Valeur par défaut `startup_probe.type = "TCP"` | Le point de terminaison `/api/v2/health` de Formbricks ne renvoie 2xx qu'en cas de pleine disponibilité (DB + Redis + dépendances), de sorte qu'une sonde HTTP ne passe jamais ; TCP réussit dès que l'application lie le port. |
| **Sonde de vivacité désactivée** | Valeur par défaut `liveness_probe.enabled = false` | La sonde de vivacité de Cloud Run ne peut pas utiliser TCP, et HTTP `/api/v2/health` relancerait en boucle un conteneur sain mais pas entièrement prêt. La sonde de démarrage TCP gère déjà le routage. |
| **Répertoire de scripts** | `scripts_dir = abspath("${module.formbricks_app.path}/scripts")` | Les scripts d'initialisation proviennent de `Formbricks Common`. |

---

## 10. Exploration avec la console GCP {#10-exploring-with-the-gcp-console}

Après le déploiement, utilisez la console GCP pour observer et opérer le déploiement Formbricks.

**Service Cloud Run :**
- Accédez à **Cloud Run** dans la console et sélectionnez votre service Formbricks (nommé `appformbricks<tenant><id>`).
- L'onglet **Revisions** affiche chaque révision déployée avec son allocation de trafic, le nombre d'instances et l'horodatage de création.
- L'onglet **Metrics** affiche le nombre de requêtes, les latences de requêtes, le nombre d'instances de conteneurs et la latence de démarrage — utile pour évaluer les paramètres `min_instance_count`.
- L'onglet **Logs** diffuse directement les journaux des conteneurs. Recherchez la sortie de migration Prisma et les messages de démarrage NextAuth.js lors du premier démarrage.
- L'onglet **YAML** révèle la spécification complète du service Cloud Run, y compris toutes les variables d'environnement injectées (les références de secrets apparaissent comme des noms de secrets, pas des valeurs).

**Secret Manager :**
- Accédez à **Security → Secret Manager** et filtrez par le préfixe de déploiement (par exemple, `formbricks-demo`).
- Les secrets auto-générés — `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` — seront tous présents.
- L'onglet **Versions** de chaque secret indique quand il a été créé. Un secret avec une seule version et aucune activité de rotation est dans son état initial.
- Cliquez sur un nom de secret pour voir quels services Cloud Run le référencent (sous **Usage**).

**Cloud SQL :**
- Accédez à **SQL** et sélectionnez l'instance PostgreSQL utilisée par Formbricks.
- L'onglet **Connections** affiche les connexions de base de données actives depuis le compte de service Cloud Run.
- L'onglet **Databases** confirme l'existence de la base de données `formbricks`.
- L'onglet **Users** confirme que l'utilisateur `formbricks` a été créé par le job `db-init`.
- L'onglet **Operations** enregistre toutes les actions administratives, y compris la création d'utilisateurs et les changements de mot de passe.

**Cloud Storage :**
- Accédez à **Cloud Storage → Buckets** et recherchez le bucket `uploads` (nommé avec le préfixe de l'application et du déploiement).
- Les pièces jointes de fichiers de réponse aux sondages téléchargées par les utilisateurs apparaissent comme des objets dans le bucket.
- L'onglet **Permissions** confirme que le compte de service HMAC a `roles/storage.objectAdmin` sur le bucket.
- L'onglet **Configuration** affiche l'état CMEK si `manage_storage_kms_iam = true`.

**Cloud Build :**
- Accédez à **Cloud Build → History** pour voir l'historique de build de l'image Formbricks.
- Chaque build correspond à un déploiement ou à une incrémentation de version.
- Cliquez sur n'importe quel build pour voir les étapes du Dockerfile, les arguments de build et la cible de push dans Artifact Registry.

**Artifact Registry :**
- Accédez à **Artifact Registry** et trouvez le dépôt pour le déploiement Formbricks.
- Les images sont étiquetées avec la valeur `application_version`.
- L'onglet **Vulnerabilities** (si l'analyse est activée) affiche les CVE détectées dans l'image Formbricks.

**Cloud Monitoring :**
- Accédez à **Monitoring → Uptime checks** pour voir le test de disponibilité créé par le module (lorsque `uptime_check_config.enabled = true`).
- Accédez à **Monitoring → Alerting** pour voir les `alert_policies` configurées.
- Dans **Metrics Explorer**, interrogez `run.googleapis.com/request_latencies` filtré par le nom de votre service pour suivre les temps de réponse p50/p95/p99.

---

## 11. Exploration avec gcloud {#11-exploring-with-gcloud}

Les commandes suivantes sont utiles pour les opérations quotidiennes d'un déploiement Formbricks Cloud Run. Remplacez `PROJECT_ID`, `REGION` et `DEPLOYMENT_ID` par vos valeurs.

**Décrire le service Cloud Run et récupérer l'URL :**
```bash
gcloud run services describe appformbricks<DEPLOYMENT_ID> \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(status.url, spec.template.spec.containers[0].resources)"
```

**Lister toutes les révisions Cloud Run et leurs répartitions de trafic :**
```bash
gcloud run revisions list \
  --service=appformbricks<DEPLOYMENT_ID> \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name, status.conditions[0].status, spec.containerConcurrency, metadata.creationTimestamp)"
```

**Suivre les journaux de conteneurs Cloud Run en direct :**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="appformbricks<DEPLOYMENT_ID>"' \
  --project=PROJECT_ID \
  --freshness=10m \
  --format="table(timestamp, textPayload)" \
  --order=asc
```

**Lister tous les secrets Formbricks dans Secret Manager :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, replication.automatic, createTime)"
```

**Afficher la dernière version d'un secret spécifique (métadonnées uniquement — pas la valeur) :**
```bash
gcloud secrets versions describe latest \
  --secret=formbricks-nextauth-secret \
  --project=PROJECT_ID
```

**Lister les jobs Cloud Run (inclut db-init) :**
```bash
gcloud run jobs list \
  --region=REGION \
  --project=PROJECT_ID \
  --filter="metadata.name~formbricks"
```

**Exécuter le job db-init manuellement (par exemple, après un changement de schéma) :**
```bash
gcloud run jobs execute formbricks-db-init-<DEPLOYMENT_ID> \
  --region=REGION \
  --project=PROJECT_ID \
  --wait
```

**Vérifier l'instance et la base de données Cloud SQL :**
```bash
gcloud sql instances describe <SQL_INSTANCE_NAME> \
  --project=PROJECT_ID \
  --format="table(name, state, databaseVersion, settings.tier, ipAddresses)"

gcloud sql databases list \
  --instance=<SQL_INSTANCE_NAME> \
  --project=PROJECT_ID
```

**Lister les buckets GCS pour le déploiement Formbricks :**
```bash
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, location, storageClass)"
```

**Afficher l'historique de Cloud Build pour les builds d'images :**
```bash
gcloud builds list \
  --project=PROJECT_ID \
  --filter="substitutions.REPO_NAME~formbricks" \
  --limit=10 \
  --format="table(id, status, createTime, duration)"
```

**Lister les images Artifact Registry :**
```bash
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --filter="package~formbricks" \
  --format="table(package, tags, updateTime)"
```

**Vérifier l'état du test de disponibilité :**
```bash
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --filter="displayName~formbricks"
```

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Formbricks CloudRun`, triées par groupe d'interface utilisateur puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP pour le déploiement des ressources. |
| `tenant_id` | 2 | `'demo'` | Court suffixe ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Étiquettes appliquées à toutes les ressources provisionnées. |
| `application_name` | 3 | `'formbricks'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `'Formbricks Surveys'` | Nom lisible par l'homme affiché dans la console GCP. |
| `description` | 3 | `'Formbricks - Open Source Survey and Experience Management'` | Description du service. |
| `application_version` | 3 | `'latest'` | Tag de l'image du conteneur. Incrémenter pour déployer une nouvelle version. |
| `webapp_url` | 3 | `""` | URL publique de l'instance Formbricks. **À définir après le premier déploiement.** |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) ou `'prebuilt'` (image existante). |
| `container_image` | 4 | `""` | URI de l'image du conteneur. Laissez vide pour que Cloud Build le gère. |
| `container_build_config` | 4 | `{ enabled = true }` | Configuration de Cloud Build : chemin Dockerfile, contexte, arguments de build. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. Mettez à niveau vers `'2000m'` pour la production. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. Formbricks (Next.js 16) nécessite un minimum de 2 Gi — 512 Mi provoque des plantages OOM au démarrage. |
| `container_port` | 4 | `3000` | Port natif de Formbricks. Ne pas modifier. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le socket du proxy d'authentification Cloud SQL. Valeur par défaut `true` — évite un échec de vérification de certificat sur TCP direct-IP. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket du proxy d'authentification lorsque `enable_cloudsql_volume = true`. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Formbricks dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Allocation de trafic Canary/bleu-vert. |
| `min_instance_count` | 4 | `0` | Instances minimales en cours d'exécution. Définissez sur `1` pour la production. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances concurrentes. Augmentez pour un trafic plus élevé. |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes par défaut (Formbricks sert les sondages/tableaux de bord sur demande ; le pipeline de réponse — e-mails de notification, webhooks, intégrations — ne s'exécute qu'après une réponse à un sondage). Définissez `true` pour les sondages en direct nécessitant des notifications/webhooks en temps réel sans attendre la prochaine requête. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Étiquettes appliquées au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès à IAP. |
| `smtp_host` | 5 | `'smtp.gmail.com'` | Nom d'hôte du serveur SMTP. Définissez sur `""` pour désactiver les e-mails. |
| `smtp_port` | 5 | `587` | Port SMTP (587 pour STARTTLS, 465 pour TLS implicite). |
| `smtp_user` | 5 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | 5 | `""` | Mot de passe SMTP. Généré automatiquement dans Secret Manager si vide. Sensible. |
| `smtp_secure_enabled` | 5 | `false` | Active le TLS implicite (`true` pour le port 465). |
| `mail_from` | 5 | `""` | Adresse de l'expéditeur dans les e-mails Formbricks. |
| `environment_variables` | 6 | Valeurs par défaut SMTP | Variables d'environnement en texte brut. Valeurs par défaut SMTP pré-remplies. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager pour des valeurs sensibles supplémentaires. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI complet) ou `'gdrive'` (ID de fichier). |
| `backup_uri` | 7 | `""` | URI GCS complet ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
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
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur racine de la base de données. |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour une découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base pour la VM NFS intégrée. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne le stockage partagé NFS. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé CMEK KMS et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `db_name` | 12 | `'formbricks'` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `db_user` | 12 | `'formbricks'` | Utilisateur de l'application PostgreSQL. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur de base de données. Ne pas modifier — Formbricks nécessite PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Formbricks Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 14 | `{ path="/api/v2/health", initial_delay_seconds=30, failure_threshold=10 }` | Sonde de démarrage ciblant le point de terminaison de santé de Formbricks. |
| `liveness_probe` | 14 | `{ path="/api/v2/health", initial_delay_seconds=15, failure_threshold=3 }` | Sonde de vivacité. |
| `startup_probe_config` | 14 | `{ enabled=true, type="TCP" }` | Sonde de démarrage du service au niveau App_CloudRun. |
| `health_check_config` | 14 | `{ enabled=true, type="HTTP", path="/" }` | Sonde de vivacité du service au niveau App_CloudRun. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |
| `enable_redis` | 21 | `true` | Redis pour la mise en cache et la limitation de débit de Formbricks. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP Redis. Par défaut, l'IP du serveur NFS si vide. |
| `redis_port` | 21 | `'6379'` | Port TCP Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe d'authentification Redis. Sensible. |
| `hub_api_url` | 21 | `'http://localhost:8080'` | URL de l'API Formbricks Hub (v5+). |
| `cubejs_api_url` | 21 | `'http://localhost:4000'` | URL de l'API d'analyse Cube.js (v5+). |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR du sous-réseau VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Enregistre les violations VPC-SC sans bloquer. Définissez `false` pour appliquer. |
| `organization_id` | 22 | `""` | ID d'organisation GCP pour VPC-SC. Découvert automatiquement si vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP où le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe de l'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (inclut le bucket `uploads`). |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, violation de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `webapp_url` | `""` (calculé automatiquement) | **Moyen** | Si laissé vide, `main.tf` calcule une URL de service Cloud Run déterministe et l'injecte comme `WEBAPP_URL`/`NEXTAUTH_URL` — Formbricks ne revient pas réellement à `localhost:3000` sur cette plateforme. Définissez `webapp_url` explicitement pour pointer les URI de redirection OAuth et les liens e-mail vers un domaine personnalisé au lieu de l'URL `run.app` prédite. |
| `db_name` | `"formbricks"` | **Critique** | Immuable après le premier déploiement — la modification entraîne la recréation de la base de données, détruisant toutes les définitions de sondages, les réponses et les données utilisateur. |
| `db_user` | `"formbricks"` | **Critique** | Immuable après le premier déploiement — la modification recrée l'utilisateur PostgreSQL et invalide tous les identifiants stockés. |
| `enable_redis` | `true` | **Élevé** | Redis est activé par défaut. Lorsque `redis_host = ""`, le module revient à l'adresse IP du serveur NFS. Si `enable_nfs = false` et `redis_host` est également vide, Formbricks ne peut pas initialiser sa couche de mise en cache et échouera au démarrage. |
| `redis_host` | `""` (résolution automatique vers l'IP NFS) | **Élevé** | S'appuie sur l'IP du serveur NFS si vide. Si NFS est également désactivé, la connectivité Redis échoue au démarrage. |
| `enable_nfs` | `true` | **Élevé** | Sans NFS, les actifs de sondage téléchargés et les pièces jointes de fichiers sont stockés sur le système de fichiers éphémère du conteneur. Tous les téléchargements sont perdus à chaque nouvelle révision Cloud Run. Plusieurs instances serviront un contenu de fichier incohérent. |
| `memory_limit` | `"2Gi"` | **Élevé** | Le runtime Next.js et l'ORM Prisma de Formbricks nécessitent une mémoire importante. Une réduction en dessous de `512Mi` provoque des plantages OOM sous un trafic de sondage normal. `2Gi` est le minimum recommandé pour la production. |
| `min_instance_count` | `0` | **Moyen** | La mise à l'échelle à zéro entraîne des démarrages à froid de 15 à 20 secondes. Les utilisateurs visitant un sondage immédiatement après une période d'inactivité subiront ce délai. Définissez sur `1` pour tout sondage de production avec des exigences SLA. |
| `cpu_always_allocated` | `false` | **Moyen** | Facturation basée sur les requêtes par défaut — le pipeline de réponse (e-mails de notification, webhooks, intégrations) ne s'exécute que lorsqu'une instance sert une requête. Si vous exécutez des sondages en direct qui nécessitent des notifications/webhooks en temps réel sans attendre la prochaine requête pour réveiller l'instance, définissez `true` (facturation basée sur l'instance, coût plus élevé). |
| `smtp_host` | `'smtp.gmail.com'` (espace réservé) | **Élevé** | Par défaut, un nom d'hôte d'espace réservé est utilisé afin que la validation d'environnement de Formbricks dispose d'un bloc SMTP complet ; sans de véritables identifiants `smtp_user`/`smtp_password`, l'envoi d'e-mails échoue toujours. Configurez un véritable fournisseur SMTP avant d'inviter des membres de l'équipe. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, le panneau d'administration de Formbricks est accessible depuis l'internet public, protégé uniquement par l'authentification propre à Formbricks. Activez-le pour tout déploiement de production. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour les déploiements de sondages actifs. Augmentez à plus de 30 jours pour toute instance Formbricks de production collectant des réponses de sondages précieuses. |
| `container_port` | `3000` | **Critique** | Formbricks se lie au port 3000. La modification de ce port sans faire correspondre la configuration du serveur d'applications entraîne l'échec de toutes les sondes de santé Cloud Run et le service est marqué comme non sain. |
| `enable_backup_import` | `false` | **Critique** | Nécessite que `backup_uri` soit un chemin GCS ou Drive valide et accessible. L'activation avec un `backup_uri` vide entraîne l'échec du job de restauration lors de l'apply. |
| `secret_propagation_delay` | `30` | **Faible** | Parfois insuffisant dans les configurations multi-régions. Augmentez à 60-90s si les secrets Formbricks ne sont pas trouvés lors de l'apply. |

---

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération de l'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** Attendez 20 à 30 minutes après la tentative de destruction initiale, puis réexécutez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

## Guides associés {#related-guides}

- [Labo pratique : Formbricks sur Cloud Run](../labs/Formbricks_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Formbricks GKE — Guide de configuration](Formbricks_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Formbricks](Formbricks_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Flarum sur Google Cloud Run](Flarum_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md), [Rallly sur Google Cloud Run](Rallly_CloudRun.md) dans la solution **Communauté et Voix du client**.
