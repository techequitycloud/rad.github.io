---
title: "Paperless-ngx sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Paperless-ngx sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Paperless_CloudRun.md @ e69407af sha256:2d2bdd81062b -->

# Paperless-ngx sur Google Cloud Run {#paperless-ngx-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Paperless_CloudRun.png" alt="Paperless-ngx sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module `modules/Paperless_CloudRun`. Il couvre l'architecture, la gestion des identités et des accès (IAM), les variables de configuration, les comportements spécifiques à Paperless-ngx et les modèles opérationnels pour le déploiement de Paperless-ngx sur Google Cloud Run (v2).

---

## Ce que coûte Paperless sur RAD, et comment cela se compare {#what-paperless-costs-on-rad-and-how-that-compares}

**Pour une archive de bureau, Paperless sur le module Cloud Run de RAD coûte environ 99 $ US par mois, sans licence par utilisateur.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont énumérées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ces 99 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 crédits par mois (environ 96 $ US au prix de la recharge, 77 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 Gio (scaleToZero) | 28,37 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 99 $ US** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg) ; la VM coûte environ 10 % de plus.
- **La mise à l'échelle à zéro est le comportement par défaut.** La ligne Cloud Run ci-dessus reflète déjà ce coût ; le paramètre `min_instance_count = 1` maintient une instance active et augmente cette ligne, en échange de l'absence de démarrages à froid.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- Aucun fournisseur ne vend de "Paperless-ngx Cloud" hébergé officiel avec des prix publics, donc cette comparaison se fait par rapport à un serveur nu.
- Un VPS nu dimensionné de manière similaire à l'empreinte de Paperless-ngx — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 $ US/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $ US/mois — est moins cher en espèces que les chiffres RAD ci-dessus.
- La différence réside dans ce que RAD gère : le stockage de documents basé sur GCS, les sauvegardes Cloud SQL et la récupération à un point dans le temps, Redis pour la file d'attente OCR/consommation, et Secret Manager pour le mot de passe administrateur — tout est inclus plutôt qu'auto-administré.
- Si Paperless doit rester actif sans mise à l'échelle à zéro, ou fonctionner à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](Paperless_GKE.md) — environ 143 $ US par mois dans votre propre projet, ou 3 390 crédits (environ 271 à 339 $ US) par mois dans un projet géré par RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Paperless fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — préparation à une certification, environnement de démonstration, activité saisonnière — que l'exécution continue de Paperless.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà dissociée, rien n'est facturé pendant cette période. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, aucune VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les 115 crédits (11,50 $ US) que coûte un redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 99 $ US.** Déployez Paperless, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps pendant lequel Paperless a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes de Paperless sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probablement supprimé dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à Paperless que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 $ US), car RAD recrée le projet et les services partagés avant Paperless. La suppression ne permet d'économiser de l'argent que si Paperless devait rester inutilisé pendant environ 4 jours ou plus, à la fois dans votre propre projet (environ 3,29 $ US par jour) et dans un projet géré par RAD (32 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et la VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Paperless pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de Paperless.
- **Conserver les données en premier.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous entrez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle.

---

## 1. Vue d'ensemble du module {#1-module-overview}

Paperless-ngx est un système de gestion de documents open source soutenu par la communauté qui transforme les documents papier en une archive numérique consultable. `Paperless CloudRun` est un **module enveloppe** construit au-dessus de `App CloudRun`. Il utilise `App CloudRun` pour toutes les provisions d'infrastructure GCP et injecte la configuration d'application spécifique à Paperless-ngx, l'initialisation de la base de données et la configuration de stockage via `Paperless Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Python/gunicorn, 2 vCPU / 2 Gio par défaut. `min_instance_count = 0` par défaut (mise à l'échelle à zéro) — défini sur `1` ou plus pour maintenir le pipeline de consommation en arrière-plan actif et éviter les retards de démarrage à froid lors des téléchargements de documents.
*   **OCR et classification** : Moteur OCR Tesseract avec packs linguistiques configurables (`ocr_language`). Classification de documents par apprentissage automatique, recherche en texte intégral, tags, correspondants, types de documents et champs personnalisés.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Volume GCS FUSE monté automatiquement à `/usr/src/paperless/media` pour le stockage persistant des documents (documents traités, miniatures, originaux).
*   **File d'attente des tâches** : Redis **obligatoire** (non optionnel). Paperless-ngx utilise Redis comme courtier de messages Celery pour le traitement OCR en arrière-plan, la classification des documents, le pipeline de consommation et les tâches asynchrones.
*   **Sécurité** : Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`. Deux secrets auto-générés par `Paperless Common` : `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY`.
*   **CI/CD** : Pipeline d'images personnalisées Cloud Build par défaut ; livraison progressive Cloud Deploy en option.
*   **Fiabilité** : Les sondes de santé ciblent `/` (la page de connexion Paperless-ngx) avec un délai initial de 60 secondes pour s'adapter aux migrations de base de données et au démarrage du worker Celery au premier démarrage.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des alertes de surveillance par e-mail. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'paperless'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Paperless-ngx - Document Management System'` | Nom lisible par l'homme affiché dans les tableaux de bord. |
| `description` | 3 | `string` | `'Paperless-ngx - open-source document management system with OCR...'` | Description du service. |
| `application_version` | 3 | `string` | `'latest'` | Tag de version de l'image du conteneur. Épinglez à une version spécifique (par exemple, `'2.13.5'`) pour la production. |

**Architecture enveloppe :** `Paperless CloudRun` appelle `Paperless Common` pour construire un objet `application_config` contenant les variables d'environnement spécifiques à Paperless-ngx, la configuration de la sonde, les définitions de bucket de stockage et la définition de job `db-init`. `module_storage_buckets` transporte le bucket `paperless-media` provisionné par `Paperless Common`. `scripts_dir` est résolu au répertoire de scripts `Paperless Common` au moment de l'apply.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Paperless_CloudRun` délègue toutes les provisions IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation de mot de passe sont identiques à ceux de `App_CloudRun`.

**Secrets d'application :** Contrairement à Ghost, `Paperless Common` génère automatiquement deux secrets au niveau de l'application au moment du déploiement :

| Secret | Description |
|---|---|
| `PAPERLESS_ADMIN_PASSWORD` | Mot de passe du compte administrateur initial. Auto-généré et stocké dans Secret Manager. |
| `PAPERLESS_SECRET_KEY` | Clé secrète de l'application Django. Auto-générée et stockée dans Secret Manager. |

Les deux secrets sont injectés nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état Terraform.

**Identité d'initialisation de la base de données :** Le job Cloud Run `db-init` s'exécute sous le compte de service Cloud Run. Il se connecte à Cloud SQL PostgreSQL via le socket Unix du proxy d'authentification (depuis `enable_cloudsql_volume = true` par défaut).

**Délai de propagation IAM de 120 secondes :** Hérité de `App CloudRun` — le service Paperless-ngx n'est pas déployé tant que le délai n'est pas terminé, ce qui empêche les échecs de lecture de secrets au premier démarrage de la révision.

Pour les tableaux de rôles complets et les détails sur IAP, la rotation de mot de passe et l'accès public, consultez la documentation `App_CloudRun`.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Paperless-ngx est une application Python Django/gunicorn avec des workers Celery en arrière-plan. Il effectue l'OCR à l'aide de Tesseract, ce qui est gourmand en CPU lors de l'ingestion de documents. `Paperless CloudRun` expose `cpu_limit` et `memory_limit` comme variables de haut niveau dédiées avec des valeurs par défaut prêtes pour la production.

**`min_instance_count = 0` et `cpu_always_allocated = false` par défaut.** Comme la plupart des modules de ce dépôt, Paperless-ngx se met à l'échelle à zéro et facture sur une base de requête par défaut (priorité au coût). L'inconvénient : le consommateur de documents en arrière-plan + le worker OCR ne fonctionnent que lorsqu'une instance est active, de sorte que les documents déposés dans le répertoire de consommation peuvent rester non traités jusqu'à ce que la prochaine requête réveille le service. Le réglage de `min_instance_count = 1` seul n'est **pas suffisant** pour restaurer le traitement continu — la facturation basée sur les requêtes (`cpu_always_allocated = false`) limite toujours le CPU à près de zéro entre les requêtes. Définissez **à la fois** `cpu_always_allocated = true` **et** `min_instance_count = 1` ou plus pour maintenir le pipeline de consommation en écoute continue avec un CPU alloué.

Le **Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` est par défaut `'custom'`, ce qui signifie que Cloud Build compile une image personnalisée à l'aide du Dockerfile de `Paperless_Common` (basé sur `ghcr.io/paperless-ngx/paperless-ngx`). Définissez `container_image_source = 'prebuilt'` et `container_image = 'ghcr.io/paperless-ngx/paperless-ngx:2.13.5'` pour déployer directement une image existante.

**Mise en miroir d'images activée par défaut** (`enable_image_mirroring = true`) : Les images Paperless-ngx sont hébergées sur GitHub Container Registry (GHCR). Le module met en miroir l'image vers Artifact Registry pour éviter les limites de débit de GHCR et pour satisfaire les exigences de Binary Authorization.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure (SQL, stockage, secrets). |
| `container_image_source` | — | `'custom'` | `'custom'` construit via Cloud Build. `'prebuilt'` déploie une URI d'image existante. |
| `container_image` | — | `""` | Remplace l'URI de l'image. Laissez vide pour que Cloud Build le gère. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés pour les charges de travail OCR. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. Minimum 2 Gio ; augmentez pour les grands lots de documents. |
| `cpu_always_allocated` | 4 | `false` | `false` = démarrage à froid prioritaire au coût (facturation basée sur les requêtes) ; le consommateur de documents + le worker OCR arrêtent le traitement lorsqu'ils sont mis à l'échelle à zéro. Définissez `true` **et** `min_instance_count >= 1` ensemble pour restaurer le fonctionnement continu. |
| `min_instance_count` | 4 | `0` | Instances minimales en cours d'exécution. Mise à l'échelle à zéro par défaut ; définissez sur `1`+ **et** `cpu_always_allocated = true` pour maintenir le pipeline de consommation actif. |
| `max_instance_count` | 4 | `3` | Instances maximales en cours d'exécution. Plafond de coût. |
| `container_port` | 4 | `8000` | Port gunicorn Paperless-ngx. Ne pas modifier sans faire correspondre le Dockerfile. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages de volume GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. L'OCR sur de grands documents peut être lent ; 300s ou plus recommandé. |
| `enable_cloudsql_volume` | 4 | `true` | Par défaut `true` — se connecte via le socket Unix du proxy d'authentification Cloud SQL. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image GHCR dans Artifact Registry. Recommandé pour éviter les limites de débit. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `traffic_split` | 4 | `[]` | Allocation de trafic canari/bleu-vert basée sur un pourcentage. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. Définissez `0` pour désactiver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Paperless CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `8000` | Le gunicorn Paperless-ngx écoute sur le port 8000. |
| `cpu_limit` | `'1000m'` | `'2000m'` | L'OCR avec Tesseract est gourmand en CPU ; 2 vCPU recommandés. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Paperless-ngx charge les miniatures de documents et les modèles ML en mémoire. |
| `enable_image_mirroring` | `false` | `true` | Mise en miroir de GHCR pour éviter les limites de débit et prendre en charge Binary Authorization. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Paperless-ngx nécessite **PostgreSQL**. `Paperless Common` corrige `database_type = "POSTGRES_15"` et configure les variables de connexion en conséquence. MySQL et SQLite ne sont pas pris en charge.

**Connexion par socket Unix :** `enable_cloudsql_volume` est par défaut `true`. `App CloudRun` injecte le sidecar Auth Proxy et définit `DB_HOST` sur le chemin du socket sous `/cloudsql`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | PostgreSQL 15. Ne pas modifier — Paperless-ngx nécessite PostgreSQL. |
| `db_name` | 12 | `'paperless'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `db_user` | 12 | `'paperless'` | Utilisateur de l'application PostgreSQL. Mot de passe auto-généré et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer le service. |

### C. Stockage (GCS Fuse) {#c-storage-gcs-fuse}

**GCS Fuse est le principal mécanisme de stockage persistant.** Contrairement à Ghost (qui s'appuie sur NFS pour le contenu), Paperless-ngx stocke tous les documents traités, les miniatures et les originaux dans un bucket GCS monté via FUSE à `/usr/src/paperless/media`. Cette conception rend Paperless-ngx bien adapté à Cloud Run — les documents survivent au recyclage des instances et à la mise à l'échelle à zéro car ils sont dans GCS, et non sur le disque local.

**Volume GCS Fuse par défaut :** Lorsque `gcs_volumes = []` (par défaut), `Paperless Common` provisionne automatiquement un bucket GCS `paperless-media` et le monte à `/usr/src/paperless/media` avec les options `implicit-dirs`, `stat-cache-ttl=60s` et `type-cache-ttl=60s`. GCS Fuse nécessite `execution_environment = 'gen2'`.

**NFS est également activé par défaut** (`enable_nfs = true`). L'adresse IP du serveur NFS est utilisée comme hôte Redis lorsqu'aucun `redis_host` n'est explicitement configuré. NFS fournit également une solution de repli de système de fichiers local pour le répertoire de consommation si nécessaire. Nécessite `execution_environment = 'gen2'`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. Lorsqu'il est vide, `Paperless Common` monte automatiquement le bucket `paperless-media` à `/usr/src/paperless/media`. Nécessite `gen2`. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création de buckets GCS supplémentaires. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires au-delà du bucket média auto-provisionné. |
| `enable_nfs` | 11 | `true` | Provisionne le serveur NFS. Utilisé comme hôte Redis lorsque `redis_host` est vide. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur pour le montage NFS. |
| `nfs_instance_name` | 11 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découvrir automatiquement ou la provisionner en ligne. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base pour une VM GCE NFS en ligne. L'ID de déploiement est ajouté. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés CMEK KMS et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic via l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via le VPC. `'ALL_TRAFFIC'` achemine toutes les sorties via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est automatiquement provisionné par `Paperless Common` lorsque `initialization_jobs` est laissé comme liste vide par défaut (`[]`). Il utilise une image client PostgreSQL et exécute `Paperless_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via le socket Unix du proxy d'authentification.
2. Crée l'utilisateur de base de données `paperless` avec le mot de passe de Secret Manager.
3. Crée la base de données `paperless` si elle n'existe pas.
4. Accorde à l'utilisateur de l'application tous les privilèges sur la base de données.

Remplacez `initialization_jobs` par une liste non vide pour remplacer ce comportement par défaut par des jobs personnalisés. Lorsque `initialization_jobs` n'est pas vide, `Paperless Common` n'injecte pas le job `db-init` par défaut.

Des jobs cron récurrents supplémentaires et des services Cloud Run sidecar supplémentaires (par exemple, Gotenberg pour la conversion de documents Office, Tika pour l'extraction de contenu) peuvent être configurés via `cron_jobs` et `additional_services` :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Paperless Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires déployés avec Paperless-ngx. Utilisez-les pour ajouter Gotenberg ou Tika. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique Cloud Armor WAF (OWASP Top 10, DDoS adaptatif, limitation de débit de 500 requêtes/min) est provisionné devant Cloud Run. Les systèmes de gestion de documents contenant des fichiers sensibles sont de solides candidats à la protection WAF.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne l'équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau). |

### B. Proxy d'authentification (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. L'authentification Google Identity est requise avant que les requêtes n'atteignent Paperless-ngx. Recommandé pour les archives de documents internes où l'accès doit être restreint aux utilisateurs organisationnels authentifiés.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

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

Les secrets d'application Paperless-ngx sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état Terraform.

`Paperless Common` génère automatiquement `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY`. Des secrets définis par l'utilisateur peuvent être ajoutés via `secret_environment_variables`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappage nom de variable d'environnement → ID de secret Secret Manager. Résolu à l'exécution. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne continuent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global soutenu par un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Le réglage `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Paperless-ngx à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS.

**Considération Paperless-ngx :** Paperless-ngx sert principalement du contenu authentifié et spécifique à l'utilisateur (listes de documents, aperçus, liens de téléchargement). La mise en cache CDN est la plus bénéfique pour les actifs statiques (CSS, JS, miniatures). Assurez-vous que les réponses de documents authentifiés incluent les en-têtes `Cache-Control: private` avant d'activer le CDN pour éviter l'empoisonnement du cache entre utilisateurs.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. N'est efficace que lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images non taguées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### C. Domaines personnalisés {#c-custom-domains}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Certificats SSL gérés par Google provisionnés par domaine. |

Après le premier apply, récupérez l'adresse IP de l'équilibreur de charge à partir de la sortie Terraform `load_balancer_ip` et créez un enregistrement `A`. Le provisionnement du certificat SSL prend 10 à 30 minutes après la propagation DNS.

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés. Le déclencheur construit et déploie une image Paperless-ngx personnalisée lorsque du code est poussé vers la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (préféré pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est mis à niveau vers un pipeline de livraison Cloud Deploy géré avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chaque : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` et `max_instance_count = 3` sont configurables via des variables (contrairement aux valeurs codées en dur de Ghost). Les tâches OCR de Paperless-ngx s'exécutent de manière asynchrone via des workers Celery soutenus par Redis — l'interface utilisateur web reste réactive pendant les tâches OCR lourdes. Plusieurs instances Cloud Run peuvent s'exécuter simultanément avec des documents stockés dans GCS.

> **Remarque sur le pipeline de consommation :** Le pipeline de consommation de documents en arrière-plan nécessite au moins une instance en cours d'exécution. Le réglage `min_instance_count = 0` signifie que les documents téléchargés ne seront pas traités tant que la prochaine requête n'aura pas activé l'instance.

### B. Répartition du trafic {#b-traffic-splitting}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Allocation de trafic basée sur un pourcentage entre les révisions nommées. Toutes les entrées doivent totaliser 100. Vide envoie 100 % à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Les sondes de démarrage et de vivacité ciblent toutes deux `/` (la page de connexion de Paperless-ngx), qui renvoie `HTTP 200` lorsque l'application est entièrement initialisée. Paperless-ngx effectue des migrations de base de données et démarre les workers Celery au premier démarrage — la sonde de démarrage autorise un délai initial de 60 secondes avec 60 seuils d'échec avant d'abandonner.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=10, period_seconds=10, failure_threshold=60 }` | Sonde de démarrage. 60 × 10s = 600s d'allocation totale pour le premier démarrage. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après 3 échecs consécutifs. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Vérification de la disponibilité facultative de Cloud Monitoring. Les alertes notifient `support_users` si inaccessible. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job de rotation Cloud Run.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Paperless-ngx.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après l'écriture du nouveau secret avant de redémarrer. |

---

## 8. Intégrations {#8-integrations}

### A. Redis (obligatoire) {#a-redis-required}

Redis est **obligatoire** et **activé par défaut** (`enable_redis = true`). Paperless-ngx utilise Redis comme courtier de messages Celery — le traitement OCR en arrière-plan, la classification des documents, les tâches du pipeline de consommation et les appels d'API asynchrones dépendent tous de Redis. Paperless-ngx ne démarrera pas sans une instance Redis accessible.

Lorsque `enable_redis = true` et `redis_host` ne sont pas fournis, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis (une instance Redis légère colocalisée sur la VM GCE NFS). Pour les déploiements de production, pointez `redis_host` vers une instance Google Cloud Memorystore pour Redis dédiée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | **Obligatoire.** Redis pour la file d'attente des tâches Celery et le backend de résultats. |
| `redis_host` | 21 | `""` | Nom d'hôte ou IP du serveur Redis. Par défaut, l'IP du serveur NFS si vide. À remplacer par Memorystore pour la production. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe d'authentification Redis. Laisser vide si Redis ne nécessite pas d'authentification. Sensible. |

### B. Paramètres de l'application Paperless-ngx {#b-paperless-ngx-application-settings}

Paperless-ngx expose plusieurs paramètres au niveau de l'application en tant que variables de premier ordre. Celles-ci sont injectées en tant que variables d'environnement par `Paperless Common`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `time_zone` | 15 | `'UTC'` | Fuseau horaire pour les horodatages des documents et les tâches planifiées. Important pour une analyse correcte des dates pendant l'OCR. Utilisez un identifiant TZ valide (par exemple, `'Europe/London'`, `'America/New_York'`). |
| `ocr_language` | 15 | `'eng'` | Code de langue Tesseract OCR. Combinez plusieurs avec `+` (par exemple, `'eng+deu+fra'`). Les packs de langue doivent être installés dans l'image du conteneur. |
| `admin_user` | 15 | `'admin'` | Nom d'utilisateur du superutilisateur auto-créé au premier démarrage. |
| `admin_email` | 15 | `'admin@example.com'` | E-mail du compte superutilisateur auto-créé. |

**Codes de langue OCR :** Utilisez les codes ISO 639-2/T tels qu'utilisés par Tesseract. Valeurs courantes : `eng` (anglais), `deu` (allemand), `fra` (français), `spa` (espagnol), `ita` (italien), `nld` (néerlandais), `por` (portugais). Le pack de langue doit être présent dans le conteneur — l'image par défaut inclut un ensemble standard ; les builds personnalisés peuvent ajouter des packs supplémentaires.

### C. Tika et Gotenberg (facultatif) {#c-tika--gotenberg-optional}

Paperless-ngx s'intègre en option avec Tika (Apache) pour l'extraction de contenu à partir de documents bureautiques et Gotenberg pour la conversion de format de document. Ceux-ci sont désactivés par défaut (`PAPERLESS_TIKA_ENABLED=false`).

Pour les activer, ajoutez-les en tant que services Cloud Run supplémentaires via `additional_services` et définissez `PAPERLESS_TIKA_ENABLED=true` dans `environment_variables` :

```hcl
additional_services = [
  {
    name         = "gotenberg"
    image        = "gotenberg/gotenberg:8"
    port         = 3000
    cpu_limit    = "1000m"
    memory_limit = "512Mi"
    ingress      = "INGRESS_TRAFFIC_ALL"
    output_env_var_name = "PAPERLESS_TIKA_GOTENBERG_ENDPOINT"
  },
  {
    name         = "tika"
    image        = "apache/tika:latest"
    port         = 9998
    cpu_limit    = "1000m"
    memory_limit = "512Mi"
    ingress      = "INGRESS_TRAFFIC_ALL"
    output_env_var_name = "PAPERLESS_TIKA_ENDPOINT"
  }
]

environment_variables = {
  PAPERLESS_TIKA_ENABLED = "true"
}
```

### D. Importation et récupération de sauvegarde {#d-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL PostgreSQL provisionnée. Ceci s'exécute après le job `db-init`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Définissez `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complet (par exemple, `'gs://my-bucket/paperless-backup.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### E. Observabilité et alertes {#e-observability--alerting}

Un test de disponibilité Cloud Monitoring interroge le point de terminaison Paperless-ngx depuis plusieurs emplacements mondiaux. Des politiques d'alerte personnalisées peuvent surveiller les métriques Cloud Run (latence, taux d'erreur, nombre d'instances) et notifier `support_users`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Configuration du test de disponibilité. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |

---

## 9. Exploration avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, les zones suivantes de la console GCP fournissent le plus d'informations sur une instance Paperless-ngx en cours d'exécution.

**Cloud Run — Détails du service**
Accédez à **Cloud Run → Services → paperless-\<deployment-id\>**. L'onglet **Revisions** affiche toutes les révisions déployées, leur pourcentage de trafic et le tag de l'image du conteneur. Cliquez sur une révision pour voir ses variables d'environnement (masquées pour les secrets) et les limites de ressources. L'onglet **Logs** diffuse les sorties stdout/stderr combinées du serveur gunicorn et du worker Celery.

**Cloud Run — URL du service**
Le champ **URL** dans l'aperçu du service est l'adresse `*.run.app` directe pour Paperless-ngx. Ouvrez-la dans un navigateur pour accéder à la page de connexion. Connectez-vous avec le nom d'utilisateur `admin_user` et le mot de passe récupéré de Secret Manager (voir §11).

**Secret Manager**
Accédez à **Security → Secret Manager**. Filtrez par le préfixe `application_name`. Vous verrez :
- `paperless-admin-password-<deployment-id>` — le mot de passe administrateur initial.
- `paperless-secret-key-<deployment-id>` — la clé secrète de l'application Django.
- `paperless-db-password-<deployment-id>` — le mot de passe de l'utilisateur de l'application PostgreSQL.

Cliquez sur n'importe quel secret et sélectionnez **View secret value** (dernière version) pour récupérer l'identifiant.

**Cloud SQL**
Accédez à **SQL → Instances**. L'instance Paperless-ngx est nommée `app<name><tenant><id>` selon la convention de nommage du dépôt. Cliquez sur l'instance, puis :
- Onglet **Databases** : confirme que la base de données `paperless` a été créée par `db-init`.
- Onglet **Users** : confirme que l'utilisateur `paperless` a été créé.
- Onglet **Connections** : affiche les connexions actives depuis le sidecar Cloud Run Auth Proxy.
- Onglet **Operations** : affiche l'historique de toutes les opérations Cloud SQL, y compris la création de bases de données et d'utilisateurs.

**Cloud Storage**
Accédez à **Cloud Storage → Buckets**. Le bucket `paperless-media-<deployment-id>` contient toutes les données de document persistantes : PDF traités, originaux, miniatures et texte extrait par OCR. Parcourez le bucket pour vérifier que les documents sont stockés. Le bucket utilise la classe de stockage `STANDARD` avec prévention d'accès public appliquée.

**Artifact Registry**
Accédez à **Artifact Registry → Repositories**. Le dépôt `paperless` stocke l'image conteneur Paperless-ngx personnalisée. L'onglet **Images** affiche les versions taguées avec les horodatages et les hachages de digest.

**Cloud Monitoring — Tests de disponibilité**
Accédez à **Monitoring → Uptime checks**. Le test de disponibilité pour la page de connexion Paperless-ngx affiche la disponibilité sur les emplacements de vérification mondiaux et les temps de réponse. Les échecs ici alertent `support_users` par e-mail.

**Cloud Build**
Accédez à **Cloud Build → History**. Chaque exécution de déploiement apparaît ici avec les logs de build. L'exécution du job Cloud Run `db-init` est déclenchée dans le cadre du pipeline d'apply.

---

## 10. Exploration avec gcloud {#10-exploring-with-gcloud}

Les commandes suivantes sont utiles pour inspecter et opérer un déploiement Paperless-ngx Cloud Run. Remplacez `PROJECT_ID`, `REGION` et `DEPLOYMENT_ID` par vos valeurs.

```bash
# List all Cloud Run services in the project
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,status.url,status.latestReadyRevisionName,status.conditions[0].status)"

# Describe the Paperless-ngx service and show the current URL
gcloud run services describe paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format="value(status.url)"

# Stream live logs from the Paperless-ngx service (last 5 minutes)
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="paperless-DEPLOYMENT_ID"' \
  --project=PROJECT_ID \
  --freshness=5m \
  --format="table(timestamp,textPayload)" \
  --order=asc

# List all revisions of the Paperless-ngx service
gcloud run revisions list \
  --project=PROJECT_ID \
  --region=REGION \
  --service=paperless-DEPLOYMENT_ID \
  --format="table(name,status.conditions[0].status,spec.containers[0].image,metadata.creationTimestamp)"

# Get the admin password from Secret Manager
gcloud secrets versions access latest \
  --secret="paperless-admin-password-DEPLOYMENT_ID" \
  --project=PROJECT_ID

# Get the Django secret key from Secret Manager
gcloud secrets versions access latest \
  --secret="paperless-secret-key-DEPLOYMENT_ID" \
  --project=PROJECT_ID

# List all secrets created for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:paperless" \
  --format="table(name,replication.automatic,createTime)"

# Describe the Cloud SQL instance
gcloud sql instances describe APP_SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,settings.tier,ipAddresses[0].ipAddress,state)"

# List databases on the Cloud SQL instance
gcloud sql databases list \
  --instance=APP_SQL_INSTANCE_NAME \
  --project=PROJECT_ID

# List Cloud SQL users
gcloud sql users list \
  --instance=APP_SQL_INSTANCE_NAME \
  --project=PROJECT_ID

# List GCS buckets for the deployment (filter by name prefix)
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name:paperless" \
  --format="table(name,location,storageClass,timeCreated)"

# List objects in the paperless-media bucket (document store)
gcloud storage ls gs://paperless-media-DEPLOYMENT_ID/

# List objects in the media/documents directory
gcloud storage ls gs://paperless-media-DEPLOYMENT_ID/documents/

# Check Memorystore Redis instance (if using dedicated Redis)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# List Cloud Run Jobs (db-init and any custom jobs)
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,status.latestCreatedExecution.name,metadata.creationTimestamp)"

# Execute the db-init job manually (e.g., for re-initialisation)
gcloud run jobs execute paperless-db-init-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION

# Get the execution status of a Cloud Run Job
gcloud run jobs executions list \
  --job=paperless-db-init-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,completionStatus,startTime,completionTime)"

# Check Cloud Monitoring uptime check results
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"

# List Artifact Registry images for the paperless repository
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/paperless \
  --project=PROJECT_ID \
  --format="table(package,version,tags,createTime)"

# Update the Cloud Run service's traffic to a specific revision (canary)
gcloud run services update-traffic paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --to-revisions=paperless-DEPLOYMENT_ID-REVISION=10,LATEST=90

# Send all traffic back to latest
gcloud run services update-traffic paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION \
  --to-latest

# Check IAM bindings on the Cloud Run service
gcloud run services get-iam-policy paperless-DEPLOYMENT_ID \
  --project=PROJECT_ID \
  --region=REGION
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Paperless CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Implémentation | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | `database_type = "POSTGRES_15"` défini par `Paperless Common` | Paperless-ngx nécessite PostgreSQL. MySQL et SQLite ne sont pas pris en charge. |
| **Mot de passe administrateur auto-généré** | Secret `PAPERLESS_ADMIN_PASSWORD` provisionné par `Paperless Common` | Le mot de passe administrateur initial est stocké dans Secret Manager. Récupérez-le via `gcloud secrets versions access latest --secret=paperless-admin-password-<id>`. |
| **Clé secrète Django auto-générée** | Secret `PAPERLESS_SECRET_KEY` provisionné par `Paperless Common` | Requis pour la signature de session Django. La régénération de cette clé invalide toutes les sessions utilisateur existantes. |
| **GCS Fuse auto-monté** | Bucket `paperless-media` monté à `/usr/src/paperless/media` | Lorsque `gcs_volumes = []`, `Paperless Common` provisionne et monte automatiquement le bucket média. Nécessite `gen2`. |
| **Redis requis** | `enable_redis = true` par défaut | Paperless-ngx ne démarrera pas sans Redis. Lorsque `redis_host = ""`, l'IP du serveur NFS est utilisée. |
| **min_instance_count = 0, cpu_always_allocated = false** | Par défaut dans `variables.tf` (mise à l'échelle à zéro, facturation basée sur les requêtes) | Par défaut, le coût est prioritaire. Définissez **à la fois** `cpu_always_allocated = true` et `min_instance_count = 1`+ pour maintenir le pipeline de consommation actif sans délai de démarrage à froid — `min_instance_count` seul n'est pas suffisant. |
| **Mise en miroir d'images activée** | `enable_image_mirroring = true` par défaut | Les images GHCR sont mises en miroir vers Artifact Registry pour éviter les limites de débit et satisfaire les exigences d'autorisation binaire. |
| **Job db-init par défaut** | Fourni par `Paperless Common` lorsque `initialization_jobs = []` | La base de données et l'utilisateur PostgreSQL sont créés automatiquement. Remplacez par une liste non vide pour remplacer. |
| **Répertoire de scripts** | `scripts_dir = abspath("${module.paperless_app.path}/scripts")` | Les scripts d'initialisation sont tirés de `Paperless Common`, et non du répertoire de déploiement. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Paperless CloudRun`, triées par groupe d'interface utilisateur.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP pour le déploiement des ressources. |
| `tenant_id` | 2 | `'demo'` | Court suffixe ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'paperless'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `'Paperless-ngx - Document Management System'` | Nom lisible par l'homme pour les tableaux de bord. |
| `description` | 3 | `'Paperless-ngx - open-source document management system...'` | Description du service. |
| `application_version` | 3 | `'latest'` | Tag de l'image du conteneur. Épinglez à une version spécifique pour la production. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés pour l'OCR. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. |
| `cpu_always_allocated` | 4 | `false` | Valeur par défaut de démarrage à froid axée sur les coûts. Définissez `true` avec `min_instance_count >= 1` pour restaurer le traitement continu du consommateur/OCR. |
| `min_instance_count` | 4 | `0` | Instances minimales. Mise à l'échelle à zéro par défaut ; définissez sur `1`+ **et** `cpu_always_allocated = true` pour maintenir le pipeline de consommation actif. |
| `max_instance_count` | 4 | `3` | Instances maximales. Plafond de coût. |
| `container_port` | 4 | `8000` | Port gunicorn Paperless-ngx. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale de la requête. Augmentez pour l'OCR de documents volumineux. |
| `enable_cloudsql_volume` | 4 | `true` | Se connecte via le socket Unix Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image GHCR vers Artifact Registry. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `traffic_split` | 4 | `[]` | Allocation de trafic Canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket Unix Auth Proxy. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/SA autorisés à accéder à IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés à accéder à IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte brut pour la configuration de Paperless-ngx. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
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
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images conteneur récentes dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime les images non taguées d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Jours après lesquels les images sont éligibles à la suppression. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne le serveur NFS. Utilisé comme hôte Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur pour le montage NFS. |
| `nfs_instance_name` | 11 | `""` | Nom de la VM GCE NFS existante. Laisser vide pour la découverte automatique. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base pour la VM NFS intégrée. |
| `gcs_volumes` | 11 | `[]` | Montages de volume GCS Fuse. Le montage automatique monte paperless-media à /usr/src/paperless/media. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé CMEK KMS pour les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry. |
| `database_type` | 12 | `'POSTGRES_15'` | Version de PostgreSQL. Ne pas modifier — Paperless-ngx nécessite PostgreSQL. |
| `db_name` | 12 | `'paperless'` | Nom de la base de données PostgreSQL. Ne pas modifier après le déploiement initial. |
| `db_user` | 12 | `'paperless'` | Utilisateur de l'application PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique du mot de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes à attendre après la rotation avant de redémarrer. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Vide : `Paperless Common` fournit la valeur par défaut `db-init`. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `additional_services` | 13 | `[]` | Services Cloud Run supplémentaires (par exemple, Gotenberg, Tika). |
| `startup_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=60, ... }` | Sonde de démarrage. Seuil d'échec long pour les migrations au premier démarrage. |
| `liveness_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=3, ... }` | Sonde de vivacité. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | 14 | `[]` | Politiques d'alerte métrique Cloud Monitoring. |
| `time_zone` | 15 | `'UTC'` | Fuseau horaire pour les horodatages des documents. Important pour l'analyse des dates OCR. |
| `ocr_language` | 15 | `'eng'` | Langue Tesseract OCR. Combinez avec `+` pour plusieurs langues. |
| `admin_user` | 15 | `'admin'` | Nom d'utilisateur du compte administrateur initial. |
| `admin_email` | 15 | `'admin@example.com'` | E-mail du compte administrateur initial. |
| `enable_redis` | 21 | `true` | **Obligatoire.** Redis pour la file d'attente des tâches Celery. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP Redis. Par défaut, l'IP du serveur NFS si vide. |
| `redis_port` | 21 | `'6379'` | Port TCP Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe d'authentification Redis. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Enregistre les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR de sous-réseau VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Enregistre les violations VPC-SC sans bloquer. Définissez `false` pour appliquer. |
| `organization_id` | 22 | `""` | ID d'organisation GCP pour VPC-SC. Découverte automatique si vide. |
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
| `load_balancer_ip` | Adresse IP statique de l'équilibreur de charge. |
| `load_balancer_url` | URL HTTPS pour accéder à l'application via l'équilibreur de charge. |
| `container_image` | Image conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Paperless-ngx nécessite PostgreSQL. Changer pour MySQL ou NONE entraînera un échec de démarrage — l'ORM de Paperless-ngx est configuré exclusivement pour PostgreSQL. |
| `enable_redis` | `true` | **Critique** | Redis est obligatoire. Sans Redis, Paperless-ngx ne peut pas démarrer ses workers Celery — le pipeline de consommation, le traitement OCR et la classification des documents sont tous inopérants. Les documents téléchargés via l'interface utilisateur web resteront en file d'attente indéfiniment. |
| `redis_host` | `""` (résolution automatique vers l'IP NFS) | **Élevé** | S'appuie sur l'IP du serveur NFS si vide. Si `enable_nfs = false` et `redis_host` restent vides avec `enable_redis = true`, Paperless-ngx ne parviendra pas à se connecter à Redis au démarrage. |
| `enable_nfs` | `true` | **Élevé** | L'IP du serveur NFS est utilisée comme hôte Redis par défaut. La désactivation de NFS sans fournir un `redis_host` explicite entraîne des échecs de connexion Redis au démarrage. |
| `execution_environment` | `'gen2'` | **Critique** | GCS Fuse nécessite Gen2. Passer à `'gen1'` alors que les volumes GCS sont montés entraîne l'échec du démarrage des révisions Cloud Run. Le volume GCS Fuse `paperless-media` est toujours monté lorsque `gcs_volumes = []`. |
| `gcs_volumes` | `[]` (montage automatique de paperless-media) | **Critique** | Le bucket `paperless-media` est le seul stockage persistant pour tous les documents Paperless-ngx. Si le montage automatique est incorrectement remplacé, les documents sont écrits dans le système de fichiers éphémère du conteneur et perdus lors du prochain déploiement de révision ou redémarrage d'instance. |
| `min_instance_count` | `0` (par défaut ; mise à l'échelle à zéro) | **Élevé** | Lorsque l'instance est froide, les documents téléchargés ne sont pas consommés tant que la prochaine requête ne réchauffe pas le service. Pour les workflows de répertoire de consommation sans surveillance, cela peut entraîner des heures de documents non traités — définissez sur `1`+ si cela est important. |
| `cpu_always_allocated` | `false` (par défaut ; facturation basée sur les requêtes) | **Élevé** | Même avec `min_instance_count >= 1`, la facturation basée sur les requêtes limite le CPU à presque zéro entre les requêtes, de sorte que le consommateur de documents + le worker OCR sont effectivement bloqués. Définissez `true` **avec** `min_instance_count >= 1` pour restaurer complètement le traitement continu en arrière-plan. |
| `db_name` | `"paperless"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur entraîne la recréation de la base de données par Terraform, détruisant toutes les métadonnées de document, les tags, les correspondants et les paramètres. Les fichiers de documents physiques dans GCS survivent mais deviennent non référencés. |
| `db_user` | `"paperless"` | **Critique** | Immuable après le premier déploiement — la modification de cette valeur recrée l'utilisateur Cloud SQL et invalide toutes les informations d'identification stockées. |
| `application_version` | `"latest"` | **Moyen** | L'utilisation de `latest` signifie que chaque exécution de Cloud Build peut extraire une nouvelle version de Paperless-ngx, ce qui peut inclure des migrations de base de données ou des changements incompatibles. Épinglez à une version spécifique (par exemple, `"2.13.5"`) pour les déploiements de production. |
| `ocr_language` | `"eng"` | **Moyen** | Définissez pour correspondre à la langue principale des documents numérisés. Des codes de langue incorrects entraînent une mauvaise qualité d'OCR et un échec de l'indexation plein texte. Plusieurs langues (`"eng+deu"`) augmentent le temps d'OCR. |
| `time_zone` | `"UTC"` | **Moyen** | Un fuseau horaire incorrect entraîne des erreurs d'analyse de date de document pendant l'OCR — les dates sur les documents numérisés peuvent être attribuées au mauvais jour. Définissez pour correspondre au fuseau horaire de votre organisation. |
| `memory_limit` | `"2Gi"` | **Élevé** | L'OCR sur des numérisations multipages à haute résolution nécessite une mémoire significative. Réduire en dessous de `1Gi` provoque des erreurs OOM Python pendant le traitement Tesseract. Pour les charges de travail OCR lourdes, `4Gi` est recommandé. |
| `timeout_seconds` | `300` | **Moyen** | L'OCR sur des PDF volumineux et multipages peut prendre plus de 300 secondes. Cloud Run mettra fin aux requêtes dépassant `timeout_seconds`. Envisagez de définir `600` ou plus pour les archives contenant de grands lots de documents. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour une archive de documents. La perte de plus de 7 jours de modifications de base de données signifie la perte de toutes les métadonnées de document (tags, correspondants, champs personnalisés, notes) ajoutées pendant cette période. Augmentez à 30+ jours pour la production. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, la page de connexion Paperless-ngx est exposée directement à Internet. Les systèmes de gestion de documents contiennent souvent des documents financiers et personnels sensibles. La protection WAF est fortement recommandée pour tout déploiement accessible via Internet. |
| `enable_iap` | `false` | **Moyen** | IAP ajoute une authentification basée sur l'identité Google devant Paperless-ngx. Pour les archives de documents internes, IAP empêche entièrement les attaques par force brute contre la page de connexion Paperless-ngx. |
| `startup_probe` failure_threshold | `60` | **Élevé** | Paperless-ngx applique les migrations de base de données au démarrage. 60 × 10s = 600 secondes de tolérance de démarrage totale. Réduire `failure_threshold` en dessous de 30 entraîne l'arrêt du conteneur par Cloud Run avant la fin des migrations lors du premier déploiement, créant une boucle de redémarrage. |

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : Libération d'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** Attendez 20 à 30 minutes après la première tentative de destruction, puis réexécutez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Paperless-ngx sur Cloud Run](../labs/Paperless_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Paperless-ngx GKE — Guide de configuration](Paperless_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Paperless-ngx](Paperless_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Odoo sur Cloud Run](Odoo_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Plateforme ERP intégrée**.
