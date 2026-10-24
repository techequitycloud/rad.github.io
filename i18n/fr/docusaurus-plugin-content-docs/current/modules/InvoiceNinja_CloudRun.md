---
title: "Invoice Ninja sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Invoice Ninja sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/InvoiceNinja_CloudRun.md @ e69407af sha256:09ec40729c05 -->

# Invoice Ninja sur Google Cloud Run {#invoice-ninja-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/InvoiceNinja_CloudRun.png" alt="Invoice Ninja sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module `modules/InvoiceNinja_CloudRun`. Il couvre l'architecture, la gestion des identités et des accès (IAM), les variables de configuration, les comportements spécifiques à Invoice Ninja et les modèles opérationnels pour le déploiement d'Invoice Ninja sur Google Cloud Run (v2).

---

## Ce que coûte Invoice Ninja sur RAD, et comment cela se compare {#what-invoice-ninja-costs-on-rad-and-how-that-compares}

**Invoice Ninja sur le module Cloud Run de RAD coûte environ 99 $ US par mois dans votre propre projet, plus des frais de module de 110 crédits (11 $ US) une fois par déploiement, sans licence par utilisateur.** Si vous n'en avez besoin que de façon saisonnière, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre vos factures. Invoice Ninja est également livré sous forme de module GKE, qui coûte plus cher ici (environ 143 $ US/mois) en raison des frais de gestion propres au cluster — Cloud Run est le choix le moins cher, sauf si vous utilisez déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **98,82 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la
base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 Gio (scaleToZero) | 28,37 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 98,82 $ US** |

### Comment cela se compare {#how-it-compares}

- Les plans hébergés d'Invoice Ninja sont **Ninja Pro à 14 $/mois** et **Enterprise à partir de 18 $/mois**
  pour 1 à 2 utilisateurs de compte, augmentant avec la taille de l'équipe — 94 $/mois pour 11 à 20 utilisateurs et jusqu'à 300 $/mois pour
  51 à 100 utilisateurs ([invoiceninja.com/pricing-plans](https://invoiceninja.com/pricing-plans/),
  8 octobre 2026).
- Le coût de fonctionnement du projet propre à RAD ici (environ 99 $/mois) est un coût d'infrastructure fixe qui ne
  change pas lorsque vous ajoutez du personnel en contact avec les clients, il coûte donc plus cher que Ninja Pro pour un seul utilisateur mais est moins cher
  que Enterprise dès qu'une poignée de personnes ont besoin de comptes.
- Un VPS nu (Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go, environ 24 $/mois) est moins cher en espèces, mais alors
  vous gérez vous-même MySQL, les sauvegardes, les correctifs de sécurité et les dépendances de rendu PDF — sur un système qui
  contient les dossiers de paiement et de facturation des clients, où ce compromis est réel.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Invoice Ninja fonctionne dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause
entre les cours, une accalmie saisonnière, ou simplement ne sachant pas encore si vous en aurez besoin le mois
prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'Invoice Ninja en tant que
module unique, cela ne supprime pas le service Cloud Run/GKE, la base de données Cloud SQL, le serveur de fichiers NFS et le réseau un par un — l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build
pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet pour lequel RAD ne gère que la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart utilisent). Google affirme que la plupart des services sont
à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. L'exportation nocturne de la base de données et des documents téléchargés d'Invoice Ninja est conservée dans ce bucket ; copiez-la d'abord si vous voulez un instantané restaurable au-delà des 30 jours du projet.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli est de supprimer
Invoice Ninja complètement et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module
  indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si Invoice Ninja resterait autrement inutilisé
  pendant environ 3 jours ou plus dans votre propre projet (environ 3 jours ou plus dans un projet géré par RAD). La base de données et le serveur de fichiers NFS représentent la majeure partie du coût de fonctionnement ici, donc la suppression d'Invoice Ninja seul permet d'économiser la totalité de la facture ci-dessus, à moins que quelque chose d'autre dans le projet ne les partage.
- **Conservez les données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et
  ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket
  que vous conservez) avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie pour la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
  par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration ; [Tarification Invoice Ninja](https://invoiceninja.com/pricing-plans/) pour la comparaison Ninja Pro/Enterprise hébergée. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble du module {#1-module-overview}

Invoice Ninja est une plateforme professionnelle de facturation et de gestion des paiements open source utilisée par les freelances et les petites entreprises. Elle fournit des devis, des factures, des reçus, des paiements clients, une facturation récurrente, le suivi des dépenses, le suivi du temps, la gestion de projet et un portail client en libre-service. `InvoiceNinja CloudRun` est un **module enveloppe** construit sur `App CloudRun`. Il utilise `App CloudRun` pour toutes les provisions d'infrastructure GCP et injecte la configuration d'application spécifique à Invoice Ninja, l'initialisation de la base de données et la configuration du stockage via `InvoiceNinja Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Laravel PHP + nginx, 2 vCPU / 2 Gio par défaut. `min_instance_count = 0` par défaut (mise à l'échelle à zéro, identique au défaut de la fondation `App_CloudRun`) — remplacez par `1` pour maintenir une instance chaude et éviter la latence de démarrage à froid lors du traitement des factures.
*   **Persistance des données** : Cloud SQL **MySQL 8.0** (pas PostgreSQL). Volumes GCS via GCS Fuse pour les PDF de factures partagés, les logos clients et les documents téléchargés. NFS activé en option pour le stockage persistant partagé.
*   **Génération de PDF** : Invoice Ninja intègre snappdf (Chromium sans interface graphique) à `/usr/local/bin/chrome`. La génération de PDF est gourmande en CPU et en mémoire — 2 vCPU / 2 Gio est le minimum recommandé.
*   **Sécurité** : Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`. Le secret `APP_KEY` est auto-généré par `InvoiceNinja Common` et stocké dans Secret Manager.
*   **File d'attente et cache** : Redis **activé par défaut** (`enable_redis = true`) — Invoice Ninja utilise Redis pour `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER`. La génération de PDF en arrière-plan et la mise en file d'attente des e-mails nécessitent Redis en production.
*   **CI/CD** : Image `invoiceninja/invoiceninja:5` pré-construite déployée par défaut (`container_image_source = 'prebuilt'`). Pipeline d'image personnalisée Cloud Build disponible.
*   **Fiabilité** : Les sondes de santé ciblent `/` avec un délai initial généreux de 90 secondes et un seuil d'échec de 30 tentatives pour s'adapter à l'initialisation PHP d'Invoice Ninja et aux migrations de base de données au premier démarrage.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des e-mails pour les alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'invoiceninja'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `application_display_name` | 3 | `string` | `'Invoice Ninja'` | Nom lisible par l'homme affiché dans la console GCP. |
| `application_description` | 3 | `string` | `'Invoice Ninja - Open-source invoicing platform'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'5'` | Tag de version de l'image Invoice Ninja. Incrémenter pour déployer une nouvelle version. |

**Architecture de l'enveloppe :** `InvoiceNinja CloudRun` appelle `InvoiceNinja Common` pour construire un objet `application_config` contenant les variables d'environnement spécifiques à Invoice Ninja, la configuration de la sonde et les définitions de job `db-init` et `artisan-migrate`. Le module injecte `DB_CONNECTION=mysql` et la configuration du générateur de PDF snappdf automatiquement. `module_storage_buckets` contient le bucket de stockage GCS provisionné par `InvoiceNinja Common`. `scripts_dir` est résolu en `abspath("${module.invoiceninja_app.path}/scripts")` au moment de l'apply.

**Note MySQL :** Invoice Ninja nécessite **MySQL 8.0**, pas PostgreSQL. `database_type = "MYSQL_8_0"` est la valeur par défaut et ne doit pas être modifiée.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`InvoiceNinja_CloudRun` délègue toutes les provisions IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation de mot de passe sont identiques à ceux d'App_CloudRun.

**Secret d'application :** `InvoiceNinja Common` génère automatiquement le secret `APP_KEY` (clé de chiffrement d'application Laravel — une valeur aléatoire de 32 octets encodée en base64, stockée sous le nom `base64:<value>`) dans Secret Manager et l'expose à la fois via sa propre sortie `secret_ids` et intégré dans `config.secret_environment_variables`. La variante `InvoiceNinja_CloudRun`, cependant, ne consomme aucune de ces valeurs directement pour le conteneur de service — elle calcule le même ID de secret elle-même (`secret-<resource_prefix>-<app>-app-key`) dans sa propre variable locale `module_secret_env_vars`, spécifiquement pour éviter un cycle de dépendance Terraform "connu après l'apply" qui se produirait autrement lorsque le secret est remplacé. L'effet net est le même : `APP_KEY` n'atteint le conteneur que comme référence Secret Manager, jamais comme variable d'environnement en texte clair.

**Identité d'initialisation de la base de données :** Les jobs Cloud Run `db-init` et `artisan-migrate` s'exécutent sous le compte de service Cloud Run. Ils se connectent à Cloud SQL MySQL via le socket Unix du proxy d'authentification (depuis `enable_cloudsql_volume = true` par défaut), en utilisant `DB_HOST` (le chemin du socket sous `/cloudsql`), `DB_USER` et `ROOT_PASSWORD` (depuis Secret Manager).

**Délai de propagation IAM de 120 secondes :** Hérité de `App CloudRun` — le service Invoice Ninja n'est pas déployé tant que le délai n'est pas terminé, ce qui empêche les échecs de lecture de secret au démarrage de la première révision.

---

## 3. Configuration du service de base {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Invoice Ninja est une application Laravel PHP avec Chromium intégré pour la génération de PDF. Ces deux composants imposent des exigences importantes en matière de ressources. `InvoiceNinja CloudRun` expose `cpu_limit` et `memory_limit` comme des variables de haut niveau dédiées.

**La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, correspondant au défaut de la fondation `App_CloudRun`). Le démarrage à froid d'Invoice Ninja implique l'initialisation de PHP-FPM, le démarrage de Laravel et la migration facultative de la base de données — cela peut prendre 20 à 40 secondes. Définissez `min_instance_count = 1` pour maintenir une instance chaude et éviter cette latence de démarrage à froid en production.

**Le boost CPU au démarrage** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` utilise par défaut `'prebuilt'`, déployant directement l'image officielle `invoiceninja/invoiceninja:5`. Définissez sur `'custom'` pour construire une image modifiée à l'aide de Cloud Build avec un Dockerfile personnalisé à partir de `InvoiceNinja_Common`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure (SQL, stockage, secrets). |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` déploie l'image officielle. `'custom'` construit via Cloud Build. |
| `container_image` | 4 | `""` | Remplace l'URI de l'image. Laissez vide pour l'image Invoice Ninja par défaut. |
| `min_instance_count` | 4 | `0` | Instances minimales en cours d'exécution (mise à l'échelle à zéro par défaut). Définissez `1` pour éviter la latence de démarrage à froid lors du traitement des factures. |
| `max_instance_count` | 4 | `3` | Instances maximales en cours d'exécution. Agit comme un plafond de coût. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU minimum pour la génération de PDF avec Chromium. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gio minimum pour Chromium ; 4 Gio recommandés pour la production. |
| `container_port` | 4 | `80` | Invoice Ninja écoute sur le port 80 via nginx. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. Augmentez pour la génération de PDF ou l'exportation de rapports. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le socket du proxy d'authentification Cloud SQL. |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes par défaut (priorité au coût, associée à `min_instance_count=0`). **Compromis :** la file d'attente/le planificateur Laravel s'arrête lorsqu'il est inactif, de sorte que les factures récurrentes et les e-mails planifiés ne sont pas déclenchés — externalisez-les via Cloud Scheduler en atteignant le point de terminaison cron, ou définissez `true` avec `min_instance_count >= 1` pour un fonctionnement continu. |
| `traffic_split` | 4 | `[]` | Allocation de trafic canary/bleu-vert basée sur un pourcentage. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `InvoiceNinja CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `80` | Invoice Ninja utilise nginx sur le port 80. |
| `cpu_limit` | `'1000m'` | `'2000m'` | La génération de PDF snappdf Chromium nécessite ≥2 vCPU pour un fonctionnement fiable. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Le processus Chromium nécessite 1 à 2 Gio en plus de l'empreinte mémoire de PHP-FPM. |
| `container_image_source` | `'custom'` | `'prebuilt'` | L'image officielle `invoiceninja/invoiceninja` est prête pour la production sans personnalisation. |
| `enable_image_mirroring` | `false` | `true` | Invoice Ninja met en miroir son image de base vers Artifact Registry par défaut. |

### B. Base de données (Cloud SQL — MySQL 8.0) {#b-database-cloud-sql--mysql-80}

Invoice Ninja nécessite **MySQL 8.0**. PostgreSQL, SQL Server et d'autres moteurs ne sont pas pris en charge et entraîneront l'échec d'Invoice Ninja au démarrage avec une erreur de pilote de base de données.

**Connexion par socket Unix :** `enable_cloudsql_volume` utilise par défaut `true`. `App CloudRun` injecte le sidecar Auth Proxy et définit `DB_HOST` sur le chemin du socket sous `/cloudsql`. Invoice Ninja lit cela via les variables d'environnement standard `DB_*`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'MYSQL_8_0'` | Moteur Cloud SQL. **Doit rester `MYSQL_8_0`** — Invoice Ninja ne prend pas en charge PostgreSQL. |
| `application_database_name` | 12 | `'invoiceninja'` | Nom de la base de données MySQL. **Ne pas modifier après le déploiement initial.** |
| `application_database_user` | 12 | `'invoiceninja'` | Utilisateur de l'application MySQL. Mot de passe auto-généré et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |

> `db_name` et `db_user` sont transmis à `InvoiceNinja Common` pour injection dans le `application_config`. Ceux-ci s'alignent avec `application_database_name` et `application_database_user` dans le chemin de provisionnement de Cloud SQL — les deux doivent être définis à la même valeur.

### C. Stockage (NFS et GCS) {#c-storage-nfs--gcs}

**NFS est activé par défaut** (`enable_nfs = true`). Invoice Ninja stocke les documents téléchargés, les logos clients, les PDF de factures et d'autres actifs sur le partage NFS afin que toutes les instances Cloud Run accèdent à un système de fichiers cohérent. Nécessite `execution_environment = 'gen2'`.

**Bucket de stockage GCS :** Un bucket GCS `data` est provisionné par défaut via `storage_buckets`. Les volumes GCS Fuse peuvent être configurés séparément pour monter des buckets directement dans le conteneur pour le stockage de documents.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisionne NFS pour le stockage partagé de documents et de fichiers. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où le partage NFS est monté. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés/clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

Cloud Run utilise Direct VPC Egress pour atteindre l'IP interne de Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, le sidecar Auth Proxy gère la connexion Cloud SQL via un socket Unix. Invoice Ninja a besoin d'un accès Internet sortant pour l'envoi d'e-mails SMTP — assurez-vous de `vpc_egress_setting = 'PRIVATE_RANGES_ONLY'` pour permettre une sortie publique directe.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — Internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic via l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | Acheminer uniquement le trafic RFC 1918 via le VPC. `'ALL_TRAFFIC'` achemine toutes les sorties via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Deux jobs Cloud Run sont provisionnés par `InvoiceNinja Common` lorsque `initialization_jobs` est laissé comme liste vide par défaut (`[]`) :

**1. `db-init`** — Utilise l'image `mysql:8.0-debian`. Opérations idempotentes :
1. Se connecte à Cloud SQL MySQL via le socket Unix du proxy d'authentification.
2. Crée l'utilisateur de base de données `invoiceninja` avec le mot de passe de Secret Manager.
3. Crée la base de données `invoiceninja` si elle n'existe pas.
4. Accorde à l'utilisateur `invoiceninja` tous les privilèges sur la base de données.

**2. `artisan-migrate`** — Utilise l'image de l'application Invoice Ninja. Exécute les migrations de base de données Laravel, y compris la création initiale du schéma et les données d'amorçage (`artisan migrate --seed`). Dépend de la réussite de `db-init`. `execute_on_apply = true` afin qu'il s'exécute à chaque déploiement pour appliquer les modifications de schéma des mises à niveau de version.

Des tâches cron récurrentes supplémentaires peuvent être définies via `cron_jobs` :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run à exécution unique. Laissez vide pour que `InvoiceNinja Common` fournisse les jobs par défaut `db-init` et `artisan-migrate`. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit de 500 requêtes/min) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne l'équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau, adresses IP de sortie CI/CD). |

### B. Proxy conscient de l'identité (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. Utile pour restreindre l'accès à Invoice Ninja aux employés authentifiés dans les flux de travail de facturation internes.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès. Format : `'group:name@example.com'`. |

### C. Autorisation binaire {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run impose que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Applique l'attestation d'image. Nécessite une politique d'autorisation binaire et un attestateur préconfigurés dans le projet. |

### D. Contrôles de service VPC {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont liés à un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets d'Invoice Ninja sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état.

**Secrets auto-générés :** `InvoiceNinja Common` génère le `APP_KEY` (clé de chiffrement Laravel) et l'injecte via `secret_environment_variables`. Les secrets `DB_PASSWORD` et `ROOT_PASSWORD` sont provisionnés automatiquement par `App CloudRun`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappage nom de variable d'environnement → ID de secret Secret Manager. Résolu à l'exécution. (par exemple, `{ MAIL_PASSWORD = "smtp-password-secret" }`) |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne continuent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global soutenu par un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

La définition de `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Invoice Ninja à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS. Invoice Ninja sert un mélange d'actifs statiques et de données de facture dynamiques. Cloud CDN est bien adapté aux actifs CSS, JS et logos d'Invoice Ninja. Assurez-vous que les réponses PDF de facture et de portail client incluent les en-têtes `Cache-Control` appropriés avant d'activer le CDN pour les chemins d'API.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. N'est efficace que lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées (pendantes) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont attachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Certificats SSL gérés par Google provisionnés par domaine. (par exemple, `['invoices.example.com']`) |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés. Étant donné que `container_image_source = 'prebuilt'` est la valeur par défaut, les déclencheurs CI/CD sont plus utiles lors du passage à `'custom'` pour construire une image Invoice Ninja modifiée avec des fichiers de thème ou des plugins spécifiques à l'entreprise.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur Cloud Build GitHub. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (étendues `repo`, `admin:repo_hook`). Requis lors du premier apply. Sensible. |
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

`min_instance_count = 0` par défaut (mise à l'échelle à zéro, correspondant au défaut de la fondation `App_CloudRun`) — définissez sur `1` pour maintenir une instance chaude en permanence. `max_instance_count = 3` assure une mise à l'échelle horizontale pendant les périodes de pointe de traitement des factures ou d'exportation par lots. Les deux valeurs sont configurables par l'utilisateur.

Invoice Ninja utilise une file d'attente basée sur Redis, de sorte que plusieurs instances peuvent traiter différents jobs de file d'attente sans contention. Les sessions sont stockées dans Redis lorsque `enable_redis = true`, ce qui rend la mise à l'échelle horizontale sûre.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge via `traffic_split`. Les sessions et les files d'attente d'Invoice Ninja basées sur Redis sont partagées entre les instances, ce qui rend les déploiements canary sûrs — les sessions client existantes persistent quelle que soit l'instance qui gère les requêtes ultérieures.

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Invoice Ninja n'expose pas de point de terminaison de santé dédié. Les sondes de démarrage et de vivacité ciblent `/` (la page de connexion ou de tableau de bord d'Invoice Ninja), qui renvoie `HTTP 200` lorsque l'application est entièrement initialisée.

Le tableau ci-dessous liste la valeur par défaut déclarée de `var.startup_probe` — **mais `startup_probe` est actuellement inerte.** Le `InvoiceNinja_CloudRun/main.tf` de `locals.invoiceninja_module` fusionne inconditionnellement une surcharge codée en dur *après* `module.invoiceninja_app.config`, de sorte que toute valeur fournie pour `var.startup_probe` est silencieusement ignorée au moment de l'apply. La sonde réellement déployée est :

```hcl
startup_probe = {
  enabled               = true
  type                  = "TCP"   # port-open check — Cloud Run health checks arrive over plain HTTP
  path                  = "/"     # ignored for a TCP probe
  initial_delay_seconds = 60
  timeout_seconds       = 10
  period_seconds        = 15
  failure_threshold     = 36
}
```

c'est-à-dire **TCP / délai initial de 60 s / 36 tentatives** (540 secondes de tolérance totale), et non la valeur par défaut HTTP/90s/30 tentatives indiquée dans le tableau des entrées. Ne comptez pas sur la modification de `startup_probe` pour modifier le type ou le timing de la sonde déployée — modifiez plutôt le bloc codé en dur dans `main.tf`. `liveness_probe` est également codé en dur dans la même fusion, mais aux valeurs identiques déclarées par sa variable (`HTTP` / `/` / délai initial de 120 s / délai d'attente de 10 s / période de 30 s / 3 échecs), donc — contrairement à `startup_probe` — sa valeur par défaut documentée correspond bien à ce qui est déployé.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=90, timeout_seconds=10, period_seconds=15, failure_threshold=30 }` | **Inerte** — `main.tf` remplace inconditionnellement cette valeur par une sonde `TCP` codée en dur (`initial_delay_seconds=60`, `failure_threshold=36`) quelle que soit la valeur de cette variable. Voir ci-dessus. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après `failure_threshold` échecs consécutifs. `main.tf` code en dur cette valeur aux mêmes valeurs, de sorte que la valeur par défaut déclarée correspond à la sonde déployée. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Vérification de la disponibilité de Cloud Monitoring (désactivée par défaut). Lorsqu'elle est activée, des alertes notifient `support_users` si elle est inaccessible. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique de Cloud Monitoring. |

### D. Rotation automatique du mot de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job de rotation Cloud Run.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL MySQL, écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Invoice Ninja.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique du mot de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après l'écriture du nouveau secret avant de redémarrer le service. |

---

## 8. Intégrations {#8-integrations}

### A. File d'attente et cache Redis {#a-redis-queue--cache}

Redis est **obligatoire pour les déploiements de production d'Invoice Ninja** (`enable_redis = true` par défaut). Invoice Ninja utilise Redis pour trois fonctions critiques :

- **`QUEUE_CONNECTION=redis`** — Traitement des tâches en arrière-plan, y compris la génération de PDF, l'envoi d'e-mails et l'envoi de webhooks. Sans Redis, ces opérations bloquent le cycle de requête HTTP, ce qui entraîne des délais d'attente.
- **`CACHE_DRIVER=redis`** — Mise en cache au niveau de l'application pour les paramètres, les données de l'entreprise et les calculs de taxes.
- **`SESSION_DRIVER=redis`** — Stockage des sessions garantissant que les utilisateurs restent connectés sur plusieurs instances Cloud Run.

Lorsque `enable_redis = true` et `redis_host` ne sont pas fournis, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis (une instance Redis légère colocalisée sur la VM GCE NFS). Pour les déploiements de production, pointez `redis_host` vers une instance Google Cloud Memorystore pour Redis dédiée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | Active Redis. Requis pour la génération de PDF en arrière-plan et la mise en file d'attente des e-mails en production. |
| `redis_host` | 21 | `""` | Nom d'hôte ou adresse IP du serveur Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe d'authentification Redis. Sensible — jamais stocké dans l'état. |

### B. SMTP et e-mail {#b-smtp--email}

Invoice Ninja envoie des e-mails transactionnels pour la livraison des factures aux clients, les approbations de devis, les confirmations de paiement et les notifications de factures récurrentes. Le SMTP doit être configuré avant la mise en service.

**Variables spécifiques à Invoice Ninja** (Groupe 23) :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `invoiceninja_admin_email` | 23 | `'admin@example.com'` | Adresse e-mail de l'administrateur pour la connexion et les notifications système. |
| `mail_from_name` | 23 | `'Invoice Ninja'` | Nom affiché comme expéditeur sur les e-mails sortants. |
| `mail_from_address` | 23 | `'ninja@example.com'` | Adresse e-mail de l'expéditeur. Doit correspondre à votre domaine d'envoi vérifié. |

Les identifiants SMTP (hôte, port, utilisateur, mot de passe) sont transmis via `environment_variables` et `secret_environment_variables` :

```hcl
environment_variables = {
  MAIL_MAILER = "smtp"
  MAIL_HOST   = "smtp.mailgun.org"
  MAIL_PORT   = "587"
  MAIL_USERNAME = "postmaster@mg.example.com"
}

secret_environment_variables = {
  MAIL_PASSWORD = "invoiceninja-smtp-password"
}
```

### C. Génération de PDF (snappdf / Chromium) {#c-pdf-generation-snappdf--chromium}

Invoice Ninja intègre snappdf avec un exécutable Chromium sans interface graphique à `/usr/local/bin/chrome`. Les variables d'environnement suivantes sont définies automatiquement par `InvoiceNinja Common` :

- `PDF_GENERATOR=snappdf`
- `SNAPPDF_EXECUTABLE_PATH=/usr/local/bin/chrome`

**Exigences en matière de CPU et de mémoire pour la génération de PDF** : Chromium crée un processus distinct pour chaque rendu PDF. Sous une charge concurrente (plusieurs clients visualisant des factures simultanément), chaque génération de PDF peut consommer jusqu'à 500 Mo de RAM et 1 vCPU. L'allocation par défaut de 2 vCPU / 2 Gi prend en charge environ 2 à 4 rendus PDF simultanés. Augmentez `memory_limit` à `'4Gi'` pour les environnements de facturation à volume élevé.

### D. Importation et récupération de sauvegarde {#d-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL MySQL provisionnée pendant l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Définissez `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complet (par exemple, `'gs://my-bucket/invoiceninja-2024-01.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### E. Observabilité et alertes {#e-observability--alerting}

Un test de disponibilité Cloud Monitoring interroge le point de terminaison Invoice Ninja depuis plusieurs emplacements mondiaux. Des règles d'alerte personnalisées peuvent surveiller les métriques Cloud Run (latence, taux d'erreur, nombre d'instances) et notifier `support_users`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Configuration du test de disponibilité. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte métrique. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées par les déclencheurs de test de disponibilité et de règles d'alerte. |

---

## 9. Comportements gérés par la plateforme {#9-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `InvoiceNinja CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Implémentation | Détail |
|---|---|---|
| **MySQL 8.0 requis** | `database_type = "MYSQL_8_0"` par défaut | L'application Laravel d'Invoice Ninja cible exclusivement MySQL. |
| **APP_KEY auto-générée** | `InvoiceNinja Common` génère et injecte via `secret_environment_variables` | Une clé de chiffrement Laravel aléatoire de 32 octets encodée en base64 est générée une fois et stockée dans Secret Manager. Elle n'est PAS régénérée lors des applys suivants. |
| **Générateur de PDF snappdf** | `PDF_GENERATOR=snappdf` et `SNAPPDF_EXECUTABLE_PATH=/usr/local/bin/chrome` injectés automatiquement | Chromium est intégré dans le conteneur `invoiceninja/invoiceninja:5`. |
| **TRUSTED_PROXIES=*** | Injecté automatiquement | Requis pour que le proxy inverse de Cloud Run transmette correctement les adresses IP des clients et les en-têtes HTTPS à Laravel. |
| **DB_CONNECTION=mysql** | Injecté automatiquement | Sélection du pilote de base de données Laravel. |
| **Redis requis pour les files d'attente** | `enable_redis = true` par défaut | Les tâches en arrière-plan d'Invoice Ninja (génération de PDF, e-mail) échouent silencieusement ou expirent sans Redis. |
| **Jobs db-init + artisan-migrate par défaut** | Fournis par `InvoiceNinja Common` lorsque `initialization_jobs = []` | La base de données MySQL, l'utilisateur et le schéma sont créés automatiquement. `artisan-migrate` s'exécute à chaque apply pour gérer les mises à niveau de version. |
| **NFS activé par défaut** | `enable_nfs = true` par défaut | Invoice Ninja stocke les téléchargements de documents, les logos de clients et les PDF générés dans le système de fichiers du conteneur. Sans NFS, ces fichiers sont perdus à chaque nouvelle révision. |
| **min_instance_count = 0** | Par défaut (correspond à `App_CloudRun`) | Invoice Ninja se met à l'échelle à zéro par défaut ; définissez `min_instance_count = 1` pour maintenir une instance chaude et éviter la latence de démarrage à froid lors de la livraison des factures aux clients. |

---

## 10. Exploration avec la console GCP {#10-exploring-with-the-gcp-console}

Après le déploiement, accédez à ces emplacements dans la console GCP pour explorer l'infrastructure Invoice Ninja.

**Service Cloud Run**
- Accédez à **Cloud Run** → sélectionnez le service `invoiceninja-<deployment-id>`.
- **Onglet Révisions** : affiche toutes les révisions déployées, l'allocation du trafic et les digests des images de conteneur. Chaque exécution `artisan-migrate` crée une nouvelle révision.
- **Onglet Journaux** : diffuse les journaux d'application. Filtrez sur `severity=ERROR` pour trouver les exceptions PHP et les jobs de file d'attente ayant échoué. Recherchez les entrées de journal `Laravel` et les messages d'erreur de Chromium.
- **Onglet Métriques** : affiche le nombre de requêtes, la latence des requêtes, le nombre d'instances de conteneur, l'utilisation du CPU et l'utilisation de la mémoire. Surveillez l'utilisation de la mémoire pendant la génération de PDF — les pics supérieurs à 1,8 Gi indiquent une pression sur la marge de manœuvre.
- **Onglet YAML** : inspectez la configuration complète du service Cloud Run, y compris toutes les variables d'environnement (texte brut uniquement — les secrets s'affichent sous forme de références), les montages de volume et la configuration des sondes.

**Jobs Cloud Run**
- Accédez à **Cloud Run** → **Jobs**. Recherchez :
  - `invoiceninja-<deployment-id>-db-init` — le job d'initialisation de la base de données MySQL.
  - `invoiceninja-<deployment-id>-artisan-migrate` — le job de migration Laravel.
- Sélectionnez un job et cliquez sur **Exécutions** pour voir l'historique de chaque exécution, les codes de sortie et la sortie du journal.
- Cliquez sur une exécution individuelle pour diffuser ses journaux — recherchez la sortie de migration de Laravel confirmant les tables créées ou ignorées.

**Cloud SQL**
- Accédez à **SQL** → sélectionnez l'instance Cloud SQL MySQL 8.0 (nommée `app<name><deploymentid>` ou similaire).
- **Vue d'ensemble** : affiche l'utilisation du CPU, de la mémoire et du stockage. Le modèle de requête d'Invoice Ninja est gourmand en lecture (génération de rapports) — surveillez les IOPS de lecture.
- **Onglet Connexions** : confirme les connexions actives depuis le proxy d'authentification Cloud Run. Chaque instance Cloud Run maintient un pool de connexions via le sidecar.
- **Bases de données** : vérifiez que la base de données `invoiceninja` existe et a été créée par le job `db-init`.
- **Utilisateurs** : vérifiez que l'utilisateur `invoiceninja` existe avec les privilèges appropriés.
- **Sauvegardes** : affiche les instantanés de sauvegarde automatisés et leur état de rétention.

**Secret Manager**
- Accédez à **Sécurité** → **Secret Manager**.
- Recherchez les secrets suivants (le préfixe varie selon le déploiement) :
  - `app<name><id>-db-password` — le mot de passe de l'utilisateur MySQL d'Invoice Ninja.
  - `app<name><id>-db-root-password` — le mot de passe root MySQL utilisé par `db-init`.
  - `app<name><id>-app-key` — la clé de chiffrement Laravel `APP_KEY`.
- Cliquez sur n'importe quel secret pour afficher les versions, l'historique d'accès et la configuration de rotation.
- **Onglet Versions** : confirmez que la dernière version est `ENABLED`. Une version `DESTROYED` ou `DISABLED` entraîne l'échec d'Invoice Ninja au démarrage avec une erreur d'accès au secret.

**Cloud Storage**
- Accédez à **Cloud Storage** → **Buckets**.
- Recherchez le bucket `app<name><id>-data` provisionné pour le stockage des documents Invoice Ninja.
- Parcourez le contenu du bucket pour voir les logos de clients téléchargés, les pièces jointes de factures et les fichiers PDF générés.
- Vérifiez les règles de **cycle de vie** pour confirmer que les politiques de rétention des sauvegardes sont appliquées.

**Artifact Registry**
- Accédez à **Artifact Registry** → **Dépôts**.
- Recherchez le dépôt pour ce déploiement. L'image `invoiceninja/invoiceninja:5` (ou une build personnalisée) y est stockée après la mise en miroir.
- Affichez les balises d'image, les valeurs de digest et les résultats d'analyse de vulnérabilité.
- Vérifiez que la politique de nettoyage supprime les images non balisées et les images au-delà de `max_images_to_retain`.

**Monitoring**
- Accédez à **Monitoring** → **Tests de disponibilité** pour afficher l'état de disponibilité du point de terminaison Invoice Ninja depuis les emplacements de sonde mondiaux.
- Accédez à **Monitoring** → **Alertes** pour afficher les règles d'alerte configurées pour ce déploiement. Des alertes sont envoyées à `support_users` lorsque le test de disponibilité échoue.
- Accédez à **Monitoring** → **Tableaux de bord** → sélectionnez le tableau de bord Cloud Run pour les métriques par service.

---

## 11. Exploration avec gcloud {#11-exploring-with-gcloud}

Utilisez ces commandes pour inspecter et dépanner le déploiement d'Invoice Ninja depuis la ligne de commande. Remplacez `PROJECT_ID`, `REGION`, `SERVICE_NAME` et `DEPLOYMENT_ID` par vos valeurs réelles.

**Inspecter le service Cloud Run**
```bash
# List all Cloud Run services in the project
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.url,status.conditions[0].status)"

# Describe the Invoice Ninja service in full detail
gcloud run services describe invoiceninja-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format=yaml

# Show the current revision serving traffic
gcloud run revisions list \
  --service=invoiceninja-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.conditions[0].type,spec.containers[0].image)"
```

**Diffuser et filtrer les journaux Cloud Run**
```bash
# Tail Invoice Ninja application logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="invoiceninja-DEPLOYMENT_ID"' \
  --project=PROJECT_ID \
  --limit=100 \
  --format="table(timestamp,severity,textPayload)" \
  --freshness=1h

# Filter for errors only
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="invoiceninja-DEPLOYMENT_ID" AND severity>=ERROR' \
  --project=PROJECT_ID \
  --limit=50 \
  --format="table(timestamp,textPayload)"

# Watch for Chromium/PDF generation events
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="invoiceninja-DEPLOYMENT_ID" AND textPayload=~"pdf|chromium|snappdf"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

**Inspecter les jobs Cloud Run (db-init, artisan-migrate)**
```bash
# List all Cloud Run jobs
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.conditions[0].type)"

# View recent executions of the artisan-migrate job
gcloud run jobs executions list \
  --job=invoiceninja-DEPLOYMENT_ID-artisan-migrate \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(metadata.name,status.conditions[0].type,status.conditions[0].lastTransitionTime)"

# Stream logs from the most recent artisan-migrate execution
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="invoiceninja-DEPLOYMENT_ID-artisan-migrate"' \
  --project=PROJECT_ID \
  --limit=100 \
  --format="table(timestamp,textPayload)" \
  --freshness=1d
```

**Inspecter Cloud SQL**
```bash
# List all Cloud SQL instances in the project
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,state,ipAddresses[0].ipAddress)"

# Describe the Invoice Ninja MySQL instance
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(name,databaseVersion,state,settings.tier,settings.dataDiskSizeGb,settings.ipConfiguration)"

# List databases on the instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List Cloud SQL users
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,passwordPolicy.status)"

# Check current active connections
gcloud sql operations list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --limit=10 \
  --format="table(name,operationType,status,startTime)"
```

**Inspecter Secret Manager**
```bash
# List all secrets for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~invoiceninja" \
  --format="table(name,replication.automatic,createTime)"

# Check the APP_KEY secret versions
gcloud secrets versions list app-key-SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Access the APP_KEY value (requires secretAccessor role — use with care)
gcloud secrets versions access latest \
  --secret=APP_KEY_SECRET_NAME \
  --project=PROJECT_ID
```

**Inspecter le stockage GCS**
```bash
# List storage buckets for this deployment
gcloud storage ls --project=PROJECT_ID | grep invoiceninja

# List top-level objects in the data bucket
gcloud storage ls gs://BUCKET_NAME/

# Check bucket IAM bindings
gcloud storage buckets get-iam-policy gs://BUCKET_NAME

# View lifecycle rules
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="json(lifecycle)"
```

**Inspecter les images Artifact Registry**
```bash
# List images in the repository
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/invoiceninja \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)"

# Show vulnerability scan results
gcloud artifacts docker images scan \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/invoiceninja:5 \
  --project=PROJECT_ID \
  --format="json"
```

**Vérifier Memorystore Redis (si vous utilisez une instance dédiée)**
```bash
# List Redis instances
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Describe a specific Redis instance
gcloud redis instances describe REDIS_INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID
```

**Tests de disponibilité et alertes**
```bash
# List uptime checks for this project
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,monitoredResource.labels.host,period,timeout)"

# List alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].conditionThreshold.filter)"
```

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `InvoiceNinja CloudRun`, triées par groupe d'interface utilisateur puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP pour le déploiement des ressources. |
| `tenant_id` | 2 | `'demo'` | Court suffixe ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'invoiceninja'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `application_display_name` | 3 | `'Invoice Ninja'` | Nom lisible par l'homme affiché dans la console GCP. |
| `application_description` | 3 | `'Invoice Ninja - Open-source invoicing platform'` | Description du service. |
| `application_version` | 3 | `'5'` | Tag de l'image conteneur Invoice Ninja. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure. |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` (image officielle) ou `'custom'` (Cloud Build). |
| `container_image` | 4 | `""` | Remplace l'URI de l'image. Laissez vide pour l'image Invoice Ninja par défaut. |
| `min_instance_count` | 4 | `0` | Instances minimales (mise à l'échelle à zéro par défaut). Définissez `1` pour maintenir Invoice Ninja chaud. |
| `max_instance_count` | 4 | `3` | Instances maximales. Agit comme un plafond de coût. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU minimum pour la génération de PDF. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gi minimum pour Chromium. |
| `container_port` | 4 | `80` | Port Nginx d'Invoice Ninja. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. Augmenter pour la génération de PDF. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le socket Unix du proxy d'authentification Cloud SQL. |
| `cpu_always_allocated` | 4 | `false` | Facturation basée sur les requêtes par défaut. Voir §3.A pour le compromis file d'attente/planificateur. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket Unix du proxy d'authentification. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Invoice Ninja dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Allocation de trafic Canary/bleu-vert. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/SA autorisés à accéder à IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés à accéder à IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte brut. Utiliser pour l'hôte SMTP, le port, le nom d'utilisateur et la configuration de la messagerie. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager (par exemple, `{ MAIL_PASSWORD = "smtp-password-secret" }`). |
| `explicit_secret_values` | 6 | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager pendant le déploiement. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI complet) ou `'gdrive'` (ID de fichier). |
| `backup_uri` | 7 | `""` | URI GCS complet ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
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
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images conteneur récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non balisées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne le stockage partagé NFS. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base pour la VM NFS intégrée. L'ID de déploiement est ajouté. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `database_type` | 12 | `'MYSQL_8_0'` | Moteur Cloud SQL. Doit rester `MYSQL_8_0` pour Invoice Ninja. |
| `application_database_name` | 12 | `'invoiceninja'` | Nom de la base de données MySQL. Ne pas modifier après le déploiement initial. |
| `application_database_user` | 12 | `'invoiceninja'` | Utilisateur de l'application MySQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour les valeurs par défaut `db-init` et `artisan-migrate`. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 14 | `{ path="/", initial_delay_seconds=90, failure_threshold=30, ... }` | **Inerte** — la valeur par défaut déclarée ici n'est jamais déployée ; `main.tf` la remplace inconditionnellement par une sonde `type="TCP"`, `initial_delay_seconds=60`, `failure_threshold=36` codée en dur. Voir §7C. |
| `liveness_probe` | 14 | `{ path="/", initial_delay_seconds=120, failure_threshold=3, ... }` | Sonde de vivacité. `main.tf` la code en dur aux mêmes valeurs que la valeur par défaut déclarée, elle est donc effectivement toujours celle-ci. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). |
| `alert_policies` | 14 | `[]` | Règles d'alerte métrique Cloud Monitoring. |
| `enable_redis` | 21 | `true` | **Activé par défaut.** Requis pour la génération de PDF et la mise en file d'attente des e-mails. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP Redis. Par défaut, l'adresse IP du serveur NFS si vide. |
| `redis_port` | 21 | `'6379'` | Port TCP Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe d'authentification Redis. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR de sous-réseau VPC pour le niveau d'accès VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Enregistre les violations VPC-SC sans bloquer. Définissez `false` pour appliquer. |
| `organization_id` | 22 | `""` | ID d'organisation GCP pour VPC-SC. Découvert automatiquement si vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés. |
| `invoiceninja_admin_email` | 23 | `'admin@example.com'` | E-mail de l'administrateur pour la connexion et les notifications. |
| `mail_from_name` | 23 | `'Invoice Ninja'` | Nom d'affichage pour les e-mails sortants. |
| `mail_from_address` | 23 | `'ninja@example.com'` | Adresse e-mail de l'expéditeur pour les e-mails sortants. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP où le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL MySQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## 14. Pièges de configuration et valeurs par défaut judicieuses {#14-configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"MYSQL_8_0"` | **Critique** | L'application Laravel d'Invoice Ninja utilise exclusivement MySQL. La définition sur `POSTGRES` entraîne l'échec d'Invoice Ninja au démarrage avec une erreur de pilote PDO. |
| `application_database_name` | `"invoiceninja"` | **Critique** | Immuable après le premier déploiement. La modification de cette valeur entraîne la recréation de la base de données par Terraform, détruisant toutes les données de facture, de client et de paiement. |
| `application_database_user` | `"invoiceninja"` | **Critique** | Immuable après le premier déploiement. La modification de cette valeur recrée l'utilisateur MySQL, invalidant les identifiants stockés et interrompant l'application. |
| `memory_limit` | `"2Gi"` | **Élevé** | Invoice Ninja crée un processus Chromium pour chaque rendu PDF. En dessous de 1 Gi, Chromium OOM-kill pendant la génération de PDF, renvoyant des PDF vierges ou des erreurs 500 aux clients. Le minimum pour Chromium est d'environ 512 Mi par rendu concurrent. |
| `cpu_limit` | `"2000m"` | **Élevé** | En dessous de 1 vCPU, le rendu PDF de Chromium ralentit considérablement et peut expirer. `timeout_seconds` peut devoir être augmenté en même temps que toute réduction de CPU. |
| `enable_redis` | `true` | **Critique** | Invoice Ninja NÉCESSITE Redis pour le traitement des files d'attente en arrière-plan. Sans Redis, la génération de PDF de facture et la livraison d'e-mails sont synchrones — elles bloquent la requête HTTP, provoquent des délais d'attente et échouent sous une charge concurrente. La désactivation de Redis en production rend le flux de travail de livraison de factures peu fiable. |
| `redis_host` | `""` (se résout automatiquement en IP NFS) | **Élevé** | Si `enable_nfs = false` et `redis_host` reste vide avec `enable_redis = true`, Invoice Ninja ne peut pas se connecter à Redis au démarrage. L'application démarrera mais les jobs de file d'attente échoueront silencieusement. |
| `enable_nfs` | `true` | **Élevé** | Invoice Ninja écrit les documents téléchargés, les logos de clients et les données mises en cache dans le système de fichiers du conteneur. Sans NFS, les fichiers téléchargés sur une instance sont invisibles pour les autres, et tous les téléchargements d'utilisateurs sont perdus à chaque nouveau déploiement de révision Cloud Run. |
| `min_instance_count` | `0` (par défaut) — définissez `1` pour la production | **Moyen** | La mise à l'échelle à zéro par défaut provoque des démarrages à froid. L'initialisation PHP-FPM d'Invoice Ninja + la vérification de la migration de la base de données prennent 10 à 30 secondes. Les clients accédant aux liens de facture pendant le démarrage à froid reçoivent des erreurs de délai d'attente. |
| `container_image_source` | `"prebuilt"` | **Faible** | L'image officielle `invoiceninja/invoiceninja` est prête pour la production. Le passage à `"custom"` nécessite un Dockerfile valide dans `InvoiceNinja_Common/scripts/` — si la build échoue, aucune nouvelle révision n'est déployée. |
| `invoiceninja_admin_email` | `"admin@example.com"` | **Moyen** | L'e-mail de l'administrateur doit être une adresse valide et accessible. L'utilisation de l'espace réservé par défaut empêche l'administrateur de recevoir les notifications système et bloque les flux de réinitialisation de mot de passe initiaux. |
| `mail_from_address` | `"ninja@example.com"` | **Élevé** | Les e-mails de livraison de facture envoyés depuis un domaine non vérifié sont susceptibles d'être rejetés par les serveurs de messagerie des clients ou marqués comme spam. Configurez un domaine d'expéditeur vérifié avant d'envoyer des factures aux clients. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour les données de facturation. Les enregistrements de factures et de paiements sont légalement requis d'être conservés dans de nombreuses juridictions. Augmentez à plus de 90 jours pour les déploiements de production. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, le panneau d'administration d'Invoice Ninja et le portail client sont exposés au trafic de bots. Les identifiants d'administration d'Invoice Ninja peuvent être ciblés par des attaques de bourrage d'identifiants. |
| `timeout_seconds` | `300` | **Moyen** | La génération de PDF pour des factures complexes à plusieurs lignes avec une marque personnalisée peut prendre 10 à 30 secondes sous charge. Les exportations de rapports sur de grandes plages de dates peuvent dépasser 300 secondes. Augmentez à `600` pour les déploiements à volume élevé. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **Moyen** | Invoice Ninja doit atteindre des serveurs SMTP externes pour la livraison d'e-mails. `PRIVATE_RANGES_ONLY` permet une sortie publique directe pour SMTP. La définition de `"ALL_TRAFFIC"` avec un pare-feu VPC restrictif bloque le SMTP sortant. |

---

## 15. Destruction des ressources {#15-destroying-resources}

### Problème de suppression connu : libération de l'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause** : GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution** : Attendez 20 à 30 minutes après la tentative de destruction initiale, puis réexécutez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : InvoiceNinja sur Cloud Run](../labs/InvoiceNinja_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Invoice Ninja GKE — Guide de configuration](InvoiceNinja_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune InvoiceNinja](InvoiceNinja_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md), [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
