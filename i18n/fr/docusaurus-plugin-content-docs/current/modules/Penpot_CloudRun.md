---
title: "Penpot sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Penpot sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Penpot_CloudRun.md @ 40c83c3f sha256:fca1aa21262b -->

# Penpot sur Google Cloud Run {#penpot-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Penpot_CloudRun.png" alt="Penpot sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète pour le module `modules/Penpot_CloudRun`. Il couvre l'architecture, la gestion des identités et des accès (IAM), les variables de configuration, les comportements spécifiques à Penpot et les modèles opérationnels pour le déploiement de Penpot sur Google Cloud Run (v2).

---

## Ce que coûte Penpot sur RAD, et comment cela se compare {#what-penpot-costs-on-rad-and-how-that-compares}

**Pour une équipe de conception de dix personnes, Penpot sur le module Cloud Run de RAD coûte environ 99 US$ par mois, sans licence par utilisateur.** Le plan Unlimited hébergé de Penpot coûte environ 70 US$ par mois pour dix éditeurs (plafonné à 175 US$ quelle que soit la taille de l'équipe) ; voir **Comment cela se compare** pour savoir ce que RAD offre en échange. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires, de sorte que ces 99 US$ deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

Votre premier déploiement réussi sur RAD est exempt des frais de module, quels que soient les frais : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : le premier à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 US$ lors d'une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (scaleToZero) | 28,37 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 99 US$** |

- Cloud SQL et Cloud Run coûtent la même chose en africa-south1 (Johannesburg) ; la VM coûte environ 10 % de plus.
- **La mise à l'échelle à zéro est la valeur par défaut.** La ligne Cloud Run ci-dessus reflète déjà ce coût ; le réglage `min_instance_count = 1` maintient une instance active et augmente cette ligne, en échange de l'absence de démarrages à froid.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 TiB, ce qui coûte environ 164 US$ par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- **Penpot vend son propre plan Unlimited hébergé** : **7 US$ par éditeur par mois**, plafonné à **175 US$/mois** quelle que soit la taille de l'équipe (penpot.app/pricing, 8 octobre 2026) — environ 70 US$/mois pour dix éditeurs. Un plan Professionnel gratuit existe également, plafonné à 8 membres d'équipe pour la collaboration en temps réel.
- Le chiffre du projet propre à RAD ci-dessus est plus élevé en termes monétaires car il s'agit d'une infrastructure dédiée — une instance Cloud SQL et des services Cloud Run dédiés, plus le bus d'événements Redis obligatoire pour la collaboration en temps réel — plutôt qu'une tranche du cloud multi-tenant de Penpot.
- Un VPS nu — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 US$/mois — est moins cher que les deux chiffres de RAD, au prix de l'exécution de PostgreSQL, Redis, des sauvegardes et des correctifs par vous-même.
- Si Penpot doit rester actif sans mise à l'échelle à zéro, ou fonctionner à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](Penpot_GKE.md) — environ 143 US$ par mois dans votre propre projet, ou 3 390 crédits (environ 271–339 US$) par mois dans un projet géré par RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Penpot fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, un environnement de démonstration, une activité saisonnière — que de faire fonctionner Penpot en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, sera utilisable après sa restauration. Par conséquent, la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, aucune VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non les 201 US$ par mois pour le maintenir en fonctionnement.** Déployez Penpot, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois et le temps pendant lequel Penpot a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD gère uniquement pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes de Penpot sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à Penpot que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) : 110 crédits (11,00 US$), car RAD recrée le projet et les services partagés avant Penpot. La suppression permet d'économiser de l'argent seulement si Penpot resterait inutilisé pendant environ 4 jours ou plus, à la fois dans votre propre projet (environ 3,29 US$ par jour) et dans un projet géré par RAD (67 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée.** Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de Penpot alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Penpot.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; [Tarification Penpot](https://penpot.app/pricing).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Penpot est une plateforme open source de conception et de prototypage — une alternative auto-hébergée à Figma. Elle offre l'édition de conception vectorielle, le prototypage interactif, les bibliothèques de composants, les jetons de conception, le transfert aux développeurs avec inspection de code, et la collaboration multijoueur en temps réel via WebSockets. `Penpot CloudRun` est un **module wrapper** construit sur `App CloudRun`. Il utilise `App CloudRun` pour toutes les provisions d'infrastructure GCP et injecte la configuration d'application spécifique à Penpot, l'architecture multi-services et la configuration de stockage d'actifs via `Penpot Common`.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), trois services coordonnés — backend (API HTTP Clojure + serveur WebSocket), frontend (nginx servant React SPA) et exportateur (Chromium sans tête pour l'exportation PDF/PNG/SVG). Le backend utilise par défaut 2 vCPU / 2 Gi.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Bucket d'actifs GCS pour les actifs de conception (polices, images, miniatures), accessible nativement via Workload Identity / ADC.
*   **Collaboration en temps réel** : Redis est **obligatoire** comme bus d'événements pub/sub WebSocket. Toutes les répliques du backend partagent l'état des événements via la base de données Redis 0. Sans Redis, l'édition multijoueur en temps réel est interrompue lorsque plus d'une instance de backend est en cours d'exécution.
*   **Sécurité** : Hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls de `App CloudRun`. Aucun secret au niveau de l'application n'est auto-généré par `Penpot Common`.
*   **Protocole** : `container_protocol` utilise par défaut `'http1'` ; définissez `'h2c'` (HTTP/2 en clair) pour le multiplexage WebSocket de bout en bout.
*   **CI/CD** : Pipeline d'images personnalisées Cloud Build par défaut ; livraison progressive Cloud Deploy facultative.
*   **Vérifications de santé** : La sonde de démarrage utilise TCP sur le port 6060 (Penpot 2.x n'expose pas de point de terminaison HTTP de santé non authentifié). Le module expose également `startup_probe_config` et `health_check_config` ciblant `/api/health` pour les vérifications de santé de l'équilibreur de charge.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des e-mails pour les alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `region` | 1 | `string` | `'us-central1'` | Région GCP pour toutes les ressources. |
| `application_name` | 3 | `string` | `'penpot'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Penpot - Open Source Design Tool'` | Nom lisible par l'homme affiché dans la console GCP. |
| `description` | 3 | `string` | `'Penpot - Open-source design and prototyping tool for teams'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'latest'` | Tag de version de l'image Penpot appliqué aux trois services. |

**Architecture du wrapper :** `Penpot CloudRun` appelle `Penpot Common` pour construire l'objet de configuration de l'application contenant les variables d'environnement spécifiques à Penpot, la configuration de la sonde et les définitions multi-services pour le backend, le frontend et l'exportateur. `module_storage_buckets` contient le bucket `penpot-assets` provisionné par `Penpot Common`. `scripts_dir` se résout en `abspath("${module.penpot_app.path}/scripts")` au moment de l'apply.

**Note PostgreSQL :** Penpot nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et ne doit pas être changée en MySQL ou SQL Server — le backend Clojure de Penpot ne prend en charge que PostgreSQL.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Penpot_CloudRun` délègue toutes les provisions IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation de mot de passe sont identiques à ceux de `App_CloudRun`.

**Pas de secrets au niveau de l'application :** `Penpot Common` ne génère pas automatiquement de secrets d'application (pas d'équivalent de `SECRET_KEY` ou `DIRECTUS_KEY`). Penpot gère ses propres clés de signature internes au moment de l'exécution. Le secret `DB_PASSWORD` est provisionné automatiquement par `App CloudRun`. Les secrets définis par l'utilisateur — y compris un mot de passe SMTP — peuvent être ajoutés via `secret_environment_variables`.

**Accès aux actifs GCS :** Le backend Penpot lit et écrit les actifs de conception (images, polices, miniatures) dans le bucket GCS `penpot-assets`. L'accès est accordé via la liaison Workload Identity du compte de service Cloud Run — aucune information d'identification explicite n'est requise. `PENPOT_STORAGE_BACKEND=gcs` et `PENPOT_STORAGE_GCS_BUCKET_NAME` sont injectés automatiquement.

**Délai de propagation IAM de 120 secondes :** Hérité de `App CloudRun` — les services Penpot ne sont pas déployés tant que le délai n'est pas écoulé, ce qui évite les échecs de lecture de secrets lors du premier démarrage de la révision.

Pour les tableaux de rôles complets et les détails sur IAP, la rotation des mots de passe et l'accès public, consultez la documentation `App_CloudRun`.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Le backend de Penpot est une application Clojure JVM. Les démarrages à froid nécessitent l'initialisation de la JVM et l'exécution des migrations PostgreSQL par l'application, ce qui peut prendre 60 à 120 secondes au premier démarrage. `min_instance_count` utilise par défaut `0` (mise à l'échelle à zéro, coût d'abord) ; définissez-le sur `1` pour maintenir le backend actif pour la collaboration en temps réel où les utilisateurs s'attendent à une connectivité instantanée.

**Protocole de conteneur :** `container_protocol` utilise par défaut `'http1'`. Définissez `'h2c'` (HTTP/2 en clair) pour activer le multiplexage WebSocket sur la même connexion pour l'édition multijoueur en temps réel.

**Déploiement multi-services :** Le frontend (nginx, port 80) et l'exportateur (Chromium sans tête) sont déployés en tant que services Cloud Run supplémentaires aux côtés du backend principal. La variable `PENPOT_PUBLIC_URI` est automatiquement définie sur l'URL de service frontend prédite. Pour les domaines personnalisés, mettez à jour `PENPOT_PUBLIC_URI` via `environment_variables` pour qu'elle corresponde à l'URL réelle à laquelle les utilisateurs accèdent.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure (PostgreSQL, GCS, secrets). |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance de backend. 2 vCPU minimum pour la gestion JVM + WebSocket. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance de backend. Augmentez à 4 Gi pour les grandes équipes ou les conceptions complexes. |
| `min_instance_count` | 4 | `0` | Instances de backend minimales. Augmentez à 1 ou plus pour la collaboration en temps réel. |
| `max_instance_count` | 4 | `1` | Instances de backend maximales. |
| `container_port` | 4 | `6060` | Port HTTP + WebSocket du backend Penpot. Ne pas modifier. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `3600` | Durée maximale de la requête. Un délai d'attente long permet des opérations d'exportation importantes. |
| `enable_cloudsql_volume` | 4 | `true` | Se connecte à Cloud SQL via un socket Unix via le sidecar Auth Proxy. |
| `container_protocol` | 4 | `'http1'` | Définissez `'h2c'` pour le multiplexage WebSocket HTTP/2 de bout en bout. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir les images Penpot dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `traffic_split` | 4 | `[]` | Allocation de trafic canari/bleu-vert basée sur un pourcentage. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Penpot CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `6060` | Port natif du backend Penpot. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | La JVM nécessite plus de mémoire que les applications Node.js/Python typiques. |
| `enable_image_mirroring` | `false` | `true` | Les images Penpot sont tirées de Docker Hub ; la mise en miroir évite les limites de débit. |
| `timeout_seconds` | `300` | `3600` | Les opérations d'exportation importantes (PDF/PNG de conceptions complexes) peuvent prendre plusieurs minutes. |

### B. Indicateurs de fonctionnalité Penpot et réglage JVM {#b-penpot-feature-flags--jvm-tuning}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `penpot_flags` | 5 | `'enable-registration enable-login disable-demo-users'` | Indicateurs de fonctionnalité Penpot séparés par des espaces. Indicateurs clés : `enable-registration` (autoriser l'auto-enregistrement), `disable-registration` (sur invitation uniquement), `enable-login-with-password`, `enable-oidc-<provider>`. |
| `jvm_max_heap` | 5 | `'1g'` | Tas maximum de la JVM. Définir à environ la moitié de `memory_limit`. Pour un conteneur de 2 Gi, `'1g'` est approprié ; pour 4 Gi, utilisez `'2g'`. |
| `jvm_min_heap` | 5 | `'512m'` | Tas initial de la JVM. Contrôle la quantité de mémoire que la JVM réserve au démarrage. |

### C. Base de données (Cloud SQL — PostgreSQL 15) {#c-database-cloud-sql--postgresql-15}

Penpot nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut. Contrairement à Ghost (MySQL), toutes les fonctionnalités standard de PostgreSQL sont disponibles. Penpot exécute ses propres migrations de base de données au démarrage — aucun job `db-init` séparé n'est nécessaire ou fourni par `Penpot Common`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `db_name` | 13 | `'penpot'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `db_user` | 13 | `'penpot'` | Utilisateur de l'application PostgreSQL. Mot de passe auto-généré et stocké dans Secret Manager. |
| `database_type` | 13 | `'POSTGRES_15'` | Moteur de base de données Cloud SQL. Ne pas modifier — Penpot nécessite PostgreSQL. |
| `database_password_length` | 13 | `32` | Longueur du mot de passe auto-généré. Plage : 16–64. |
| `enable_auto_password_rotation` | 6 | `false` | Rotation automatique des mots de passe sans interruption. |
| `rotation_propagation_delay_sec` | 6 | `90` | Secondes à attendre après la rotation avant de redémarrer les services. |

### D. Stockage (bucket d'actifs GCS) {#d-storage-gcs-assets-bucket}

`Penpot Common` provisionne automatiquement un bucket GCS `penpot-assets` pour les actifs de conception (polices, images téléchargées par l'utilisateur, miniatures). Le backend accède à ce bucket via `PENPOT_STORAGE_BACKEND=gcs` et ADC/Workload Identity — aucune information d'identification explicite n'est requise.

NFS est également disponible (`enable_nfs = true`) pour le stockage de fichiers partagés. Lorsque `redis_host` n'est pas fourni, le module utilise l'adresse IP du serveur NFS comme hôte Redis de secours.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `create_cloud_storage` | 12 | `true` | Définissez `false` pour ignorer la création de buckets supplémentaires. Le bucket `penpot-assets` de `Penpot Common` est toujours provisionné. |
| `storage_buckets` | 12 | `[]` | Buckets GCS supplémentaires au-delà du bucket d'actifs auto-provisionné. |
| `enable_nfs` | 12 | `true` | Provisionne un volume NFS pour le stockage partagé. Également utilisé comme hôte Redis de secours. |
| `nfs_mount_path` | 12 | `'/mnt/nfs'` | Chemin du conteneur où le partage NFS est monté. |
| `gcs_volumes` | 12 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `manage_storage_kms_iam` | 12 | `false` | Crée un trousseau de clés KMS CMEK et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 12 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### E. Réseau {#e-networking}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 8 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic via l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 8 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via le VPC. |

### F. Initialisation {#f-initialization}

Penpot exécute ses propres migrations PostgreSQL au démarrage du backend. Aucun job Cloud Run `db-init` séparé n'est injecté par `Penpot Common` — le processus Clojure du backend applique automatiquement les migrations avant que l'application n'accepte le trafic. Prévoyez 60 à 120 secondes pour le premier démarrage.

Les jobs d'initialisation personnalisés et les jobs cron sont toujours pris en charge via les variables `initialization_jobs` et `cron_jobs`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 15 | `[]` | Jobs Cloud Run à exécution unique pendant le déploiement. Laissez vide — Penpot gère ses propres migrations. |
| `cron_jobs` | 15 | `[]` | Jobs Cloud Run planifiés récurrents. Chaque entrée : `name`, `schedule`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. WAF Cloud Armor {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global avec une politique WAF Cloud Armor (OWASP Top 10, DDoS adaptatif, limitation de débit de 500 requêtes/min) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 14 | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. Requis pour les domaines personnalisés et la protection DDoS. |
| `admin_ip_ranges` | 14 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de l'équipe de conception, IP de sortie CI/CD). |

### B. Proxy conscient de l'identité (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'authentification d'identité Google est requise avant que les requêtes n'atteignent Penpot. Utile pour restreindre l'accès aux équipes de conception internes sans gérer les comptes d'utilisateurs Penpot pour chaque visiteur.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 8 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 8 | `[]` | Utilisateurs/comptes de service autorisés à accéder. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 8 | `[]` | Groupes Google autorisés à accéder. Format : `'group:name@example.com'`. |

### C. Autorisation binaire {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run impose que les images Penpot déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 10 | `false` | Applique l'attestation d'image. Nécessite une politique d'autorisation binaire préconfigurée dans le projet. |

### D. Contrôles de service VPC {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont liés à un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 18 | `false` | Enregistre les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister. |
| `vpc_cidr_ranges` | 18 | `[]` | Plages CIDR de sous-réseau VPC pour le niveau d'accès réseau VPC-SC. Découvertes automatiquement si vides. |
| `vpc_sc_dry_run` | 18 | `true` | Enregistre les violations VPC-SC sans les bloquer. Définissez `false` pour appliquer. |
| `organization_id` | 18 | `""` | Remplacement de l'ID d'organisation GCP pour VPC-SC. Découvert automatiquement à partir du projet si vide. |
| `enable_audit_logging` | 18 | `false` | Active les journaux d'audit Cloud détaillés (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets Penpot sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Mappage du nom de la variable d'environnement → ID du secret Secret Manager. Utilisez pour les mots de passe SMTP, les secrets client OIDC, etc. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret avant que les ressources dépendantes ne continuent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global soutenu par un NEG sans serveur est provisionné. Le trafic circule : Internet → Cloud Armor → Équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Le réglage `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Penpot à passer par l'équilibreur de charge, empêchant l'accès direct à l'URL `*.run.app`. Ceci est recommandé pour les déploiements de production où l'adresse IP de l'équilibreur de charge est le point d'entrée canonique.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est attaché au backend de l'équilibreur de charge HTTPS.

**Considération Penpot :** Penpot sert un mélange d'appels d'API de conception authentifiés et d'actifs frontend statiques (React SPA, CSS, polices). Le CDN est bien adapté aux actifs statiques du frontend, mais ne doit pas mettre en cache les réponses d'API ou les connexions WebSocket. Le frontend nginx sert les actifs avec des en-têtes de cache appropriés ; l'API backend ne doit pas être mise en cache par le CDN.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 14 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 14 | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 14 | `true` | Supprime automatiquement les images non taguées d'Artifact Registry. |
| `image_retention_days` | 14 | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont attachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement.

**Important pour Penpot :** Après avoir ajouté un domaine personnalisé, définissez `PENPOT_PUBLIC_URI` via `environment_variables` pour qu'il corresponde à l'URL du domaine personnalisé. Penpot utilise `PENPOT_PUBLIC_URI` pour générer des liens dans les invitations par e-mail et pour acheminer les connexions WebSocket. Une non-concordance entraîne des liens d'invitation rompus et des échecs de connexion WebSocket.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 14 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. (par exemple, `['design.example.com']`) |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur de push sont provisionnés.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 10 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 10 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 10 | `""` | PAT GitHub (scopes `repo`, `admin:repo_hook`). Sensible. |
| `github_app_installation_id` | 10 | `""` | ID d'installation de l'application GitHub (préféré pour les dépôts d'organisation). |
| `cicd_trigger_config` | 10 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est mis à niveau vers un pipeline de livraison Cloud Deploy géré avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 10 | `false` | Provisionne un pipeline Cloud Deploy. |
| `cloud_deploy_stages` | 10 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count` est défini par défaut sur `0` (mise à l'échelle à zéro). Le fait de le définir sur `1` maintient au moins une instance de backend en cours d'exécution en permanence, ce qui est important pour Penpot car :

1. Les connexions WebSocket des collaborateurs actifs sont interrompues lors des événements de mise à l'échelle à zéro.
2. Les démarrages à froid de la JVM prennent 30 à 60 secondes, pendant lesquelles les nouvelles tentatives de connexion échouent.
3. La collaboration en temps réel nécessite une connexion persistante au bus d'événements via Redis.

Redis gère la diffusion WebSocket entre les réplicas de backend, de sorte que la mise à l'échelle horizontale est sûre. Toutes les instances de backend publient et s'abonnent au même canal Redis, et les événements de modification de conception sont diffusés à tous les clients connectés, quelle que soit l'instance à laquelle ils sont connectés.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge pour les déploiements canary.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Allocation de trafic basée sur un pourcentage entre les révisions nommées. Toutes les entrées doivent totaliser 100. Une valeur vide envoie 100 % à la dernière révision. |

**Considération Penpot :** les déploiements canary nécessitent une gestion minutieuse des connexions WebSocket. Les sessions actives connectées à l'ancienne révision y resteront jusqu'à la reconnexion. Concevez pour accepter que les deux révisions soient actives simultanément pendant la fenêtre canary.

### C. Sondes de santé {#c-health-probes}

Penpot 2.x n'expose pas de point de terminaison de santé HTTP non authentifié sur le chemin racine. Le module utilise une **sonde de démarrage TCP** sur le port 6060 (vérifie que le processus backend est à l'écoute), combinée à `startup_probe_config` et `health_check_config` ciblant `/api/health` pour les vérifications de santé de l'équilibreur de charge.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 16 | `{ type="TCP", port=6060, initial_delay_seconds=5, period_seconds=5, failure_threshold=40 }` | Sonde de démarrage TCP. Permet un temps de démarrage total de 200 secondes (5s × 40). |
| `liveness_probe` | 16 | `{ enabled=false }` | Désactivé par défaut — Cloud Run ne prend pas en charge les sondes de vivacité TCP. |
| `startup_probe_config` | 16 | `{ enabled=true, type="TCP", path="/api/health", timeout_seconds=240 }` | Sonde de démarrage alternative pour les vérifications de santé de l'équilibreur de charge. |
| `health_check_config` | 16 | `{ enabled=true, type="HTTP", path="/api/health", period_seconds=10 }` | Sonde de vivacité HTTP ciblant `/api/health`. |
| `uptime_check_config` | 16 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif. Les alertes notifient `support_users`. |
| `alert_policies` | 16 | `[]` | Règles d'alerte de métriques Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation de mot de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle de `secret_rotation_period`.
2. Eventarc déclenche un job de rotation Cloud Run.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le backend Penpot.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 6 | `false` | Active la rotation automatique des mots de passe. |
| `rotation_propagation_delay_sec` | 6 | `90` | Secondes à attendre après la rotation avant de redémarrer les services. |

---

## 8. Intégrations {#8-integrations}

### A. Redis (obligatoire pour les déploiements multi-instances) {#a-redis-mandatory-for-multi-instance-deployments}

Redis est **activé par défaut** (`enable_redis = true`). Penpot utilise Redis comme bus d'événements pub/sub WebSocket. Lorsqu'un concepteur apporte une modification, le backend publie l'événement sur Redis, et toutes les autres instances de backend le reçoivent et le transmettent à leurs clients WebSocket connectés. Sans Redis, la collaboration en temps réel ne fonctionne que lorsque tous les clients sont connectés à la même instance de backend — ce qui n'est pas garanti avec l'équilibrage de charge de Cloud Run.

Lorsque `enable_redis = true` et `redis_host` n'est pas fourni, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis. Pour les déploiements de production avec plusieurs instances de backend, pointez `redis_host` vers une instance Google Cloud Memorystore for Redis dédiée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 17 | `true` | Active Redis pour le pub/sub WebSocket. Obligatoire pour la collaboration multi-instances. |
| `redis_host` | 17 | `""` | Nom d'hôte ou IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS. Utilisez Memorystore pour la production. |
| `redis_port` | 17 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 17 | `""` | Mot de passe d'authentification Redis. Sensible — jamais stocké dans l'état. |

### B. E-mail (SMTP) {#b-email-smtp}

Penpot utilise SMTP pour les invitations d'équipe et les réinitialisations de mot de passe. `smtp_enabled` doit être défini sur `true` pour activer l'envoi d'e-mails. Contrairement à d'autres modules, SMTP est désactivé par défaut dans Penpot CloudRun — il doit être explicitement activé.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `smtp_enabled` | 7 | `false` | Active l'envoi d'e-mails SMTP. Doit être `true` pour que les invitations et les réinitialisations de mot de passe fonctionnent. |
| `smtp_from` | 7 | `""` | Adresse de l'expéditeur par défaut. (par exemple, `'noreply@example.com'`) |
| `smtp_reply_to` | 7 | `""` | Adresse de réponse par défaut. |
| `smtp_host` | 7 | `""` | Nom d'hôte du serveur SMTP. |
| `smtp_port` | 7 | `587` | Port SMTP. `587` pour STARTTLS, `465` pour SSL. |
| `smtp_username` | 7 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_use_tls` | 7 | `true` | Activer STARTTLS. |
| `smtp_use_ssl` | 7 | `false` | Activer SSL/TLS. |

Pour le mot de passe SMTP, utilisez `secret_environment_variables` :

```
secret_environment_variables = {
  PENPOT_SMTP_PASSWORD = "penpot-smtp-password"
}
```

### C. Importation et récupération de sauvegardes {#c-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde PostgreSQL existante dans l'instance Cloud SQL provisionnée pendant l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 9 | `'0 2 * * *'` | Expression Cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 9 | `7` | Jours de rétention des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 9 | `false` | Déclenche une restauration unique lors de l'apply. Définissez `false` après une importation réussie. |
| `backup_source` | 9 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 9 | `""` | URI GCS complet (par exemple, `'gs://my-bucket/penpot-2024-01.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 9 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### D. Scripts SQL personnalisés {#d-custom-sql-scripts}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 11 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 11 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 11 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 11 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |

### E. Observabilité et alertes {#e-observability--alerting}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 16 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif sur `/api/health`. |
| `alert_policies` | 16 | `[]` | Règles d'alerte personnalisées. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées par les déclencheurs de test de disponibilité et de règles d'alerte. |

---

## 9. Exploration avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, les chemins suivants de la console GCP sont les plus utiles pour comprendre et valider le déploiement de Penpot.

**Services Cloud Run**

Accédez à **Cloud Run** dans la console GCP. Vous verrez plusieurs services :
- Le service backend principal de Penpot (port 6060) avec son URL `*.run.app`.
- Le service frontend (nginx, port 80) dont l'URL est le point d'entrée visible par l'utilisateur.
- Le service d'exportation (Chromium sans interface graphique) pour l'exportation PDF/PNG/SVG.

Cliquez sur le service backend pour afficher :
- Onglet **Révisions** : révision active, allocation de trafic, nombre d'instances.
- Onglet **Journaux** : messages de démarrage de la JVM, sortie de migration, événements de connexion WebSocket.
- Onglet **Métriques** : nombre de requêtes, percentiles de latence, nombre d'instances au fil du temps, utilisation du CPU/mémoire du conteneur.

**Cloud SQL**

Accédez à **SQL** dans la console GCP. L'instance Penpot PostgreSQL 15 affiche :
- Nom de la connexion (nécessaire pour `gcloud sql connect`).
- Connexions actuelles et informations sur les requêtes.
- Planification des sauvegardes automatisées et horodatage de la dernière sauvegarde.

Cliquez sur le nom de l'instance, puis sur **Bases de données** pour confirmer que la base de données `penpot` existe et sur **Utilisateurs** pour confirmer que l'utilisateur `penpot` est présent.

**Cloud Storage**

Accédez à **Cloud Storage → Buckets**. Le bucket `penpot-assets` stocke :
- `thumbnails/` — images miniatures des fichiers de conception.
- `objects/` — ressources de conception téléchargées (images, polices).

Vérifiez que le bucket existe et que le compte de service Cloud Run dispose de `roles/storage.objectAdmin` sur celui-ci.

**Secret Manager**

Accédez à **Sécurité → Secret Manager**. Les secrets provisionnés pour ce déploiement incluent :
- `DB_PASSWORD` (mot de passe de l'utilisateur de l'application Penpot PostgreSQL).

Si SMTP est activé, votre secret SMTP apparaîtra également ici s'il a été ajouté via `secret_environment_variables`.

**Tests de disponibilité de la surveillance**

Accédez à **Surveillance → Tests de disponibilité**. Le test de disponibilité de Penpot interroge `/api/health` depuis plusieurs régions GCP mondiales. Un échec de test déclenche un e-mail d'alerte à `support_users`.

**Artifact Registry**

Accédez à **Artifact Registry**. Les images backend, frontend et d'exportation de Penpot y sont stockées après la mise en miroir depuis Docker Hub. Vérifiez que les trois images sont présentes et correctement étiquetées.

---

## 10. Exploration avec gcloud {#10-exploring-with-gcloud}

Les commandes gcloud suivantes sont utiles pour inspecter et dépanner le déploiement Penpot Cloud Run. Remplacez `PROJECT_ID`, `REGION` et `SERVICE_NAME` par vos valeurs réelles.

**Lister tous les services Penpot Cloud Run dans le projet :**
```bash
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --filter="metadata.name:penpot" \
  --format="table(metadata.name,status.url,status.conditions[0].status)"
```

**Décrire le service backend Penpot (affiche les variables d'environnement, la mise à l'échelle, la répartition du trafic) :**
```bash
gcloud run services describe penpot-backend \
  --project=PROJECT_ID \
  --region=REGION \
  --format=yaml
```

**Vérifier la révision actuelle et le nombre d'instances :**
```bash
gcloud run revisions list \
  --project=PROJECT_ID \
  --region=REGION \
  --service=penpot-backend \
  --format="table(metadata.name,status.observedGeneration,spec.containerConcurrency,status.conditions[0].status)"
```

**Afficher les journaux en direct du backend Penpot :**
```bash
gcloud run services logs tail penpot-backend \
  --project=PROJECT_ID \
  --region=REGION
```

**Récupérer les journaux récents filtrés pour les erreurs uniquement :**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="penpot-backend" AND severity>=ERROR' \
  --project=PROJECT_ID \
  --limit=50 \
  --format="table(timestamp,jsonPayload.message)"
```

**Vérifier l'état de l'instance Cloud SQL :**
```bash
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion,settings.dataDiskSizeGb,ipAddresses[0].ipAddress)"
```

**Lister les bases de données Cloud SQL sur l'instance Penpot :**
```bash
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID
```

**Se connecter à la base de données Penpot PostgreSQL (nécessite Cloud SQL Auth Proxy ou Cloud Shell) :**
```bash
gcloud sql connect INSTANCE_NAME \
  --user=penpot \
  --database=penpot \
  --project=PROJECT_ID
```

**Lister le contenu du bucket GCS penpot-assets par préfixe :**
```bash
gcloud storage ls gs://penpot-assets-PROJECT_ID/thumbnails/ --recursive
```

**Vérifier les secrets Secret Manager pour ce déploiement :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:penpot" \
  --format="table(name,createTime,replication.automatic)"
```

**Récupérer le mot de passe actuel de la base de données (à des fins de diagnostic uniquement) :**
```bash
gcloud secrets versions access latest \
  --secret=penpot-db-password \
  --project=PROJECT_ID
```

**Vérifier les instances Memorystore Redis (si vous utilisez Redis dédié) :**
```bash
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"
```

**Lister les jobs Cloud Run (jobs d'initialisation ou cron) :**
```bash
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --filter="metadata.name:penpot" \
  --format="table(metadata.name,status.latestCreatedExecution.completionTimestamp,status.latestCreatedExecution.succeededCount)"
```

**Vérifier Artifact Registry pour les images Penpot mises en miroir :**
```bash
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY \
  --filter="package:penpot" \
  --format="table(package,tags,createTime,updateTime)"
```

**Vérifier que le compte de service Cloud Run a accès au stockage du bucket d'actifs :**
```bash
gcloud storage buckets get-iam-policy gs://penpot-assets-PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Penpot CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Implémentation | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | Valeur par défaut `database_type = "POSTGRES_15"` | Penpot ne prend en charge que PostgreSQL. Ne pas changer pour MySQL ou SQL Server. |
| **Pas de job db-init** | Penpot exécute ses propres migrations au démarrage | Contrairement à Django ou Ghost, aucun job Cloud Run `db-init` n'est injecté. Le processus Clojure de Penpot applique les migrations automatiquement au premier démarrage. |
| **Protocole http1 par défaut** | `container_protocol = "http1"` | Définissez `"h2c"` (HTTP/2 en texte clair) pour activer le multiplexage WebSocket pour la collaboration en temps réel. |
| **Mise à l'échelle à zéro par défaut** | Valeur par défaut `min_instance_count = 0` | Par défaut, le coût est prioritaire. Définissez `1` pour la collaboration active — les sessions WebSocket sont terminées lors de la réduction d'échelle. |
| **Bucket d'actifs GCS** | Bucket `penpot-assets` provisionné par `Penpot Common` | Utilisé pour le stockage des actifs de conception. Accessible via `PENPOT_STORAGE_BACKEND=gcs`. |
| **Mise en miroir d'images activée par défaut** | Valeur par défaut `enable_image_mirroring = true` | Les trois images Penpot sont mises en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| **Redis pour la diffusion WebSocket** | Valeur par défaut `enable_redis = true` | Sans Redis, la collaboration en temps réel est interrompue sous l'équilibrage de charge sur plusieurs instances. |
| **Délai d'expiration de requête long** | Valeur par défaut `timeout_seconds = 3600` | Les exportations PDF et PNG de conceptions complexes de plusieurs pages peuvent prendre plusieurs minutes. |
| **Pas de secrets d'application auto-générés** | `module_secret_env_vars = {}` | Penpot gère ses propres clés de signature internes. Aucun équivalent `SECRET_KEY` n'est créé. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur, triées par groupe d'interface utilisateur puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région de déploiement GCP. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail pour les alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'penpot'` | Nom de ressource de base. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `'Penpot - Open Source Design Tool'` | Nom lisible par l'homme. |
| `description` | 3 | `'Penpot - Open-source design and prototyping tool for teams'` | Description du service. |
| `application_version` | 3 | `'latest'` | Tag de l'image conteneur Penpot. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement uniquement d'infrastructure. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance de backend. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance de backend. |
| `min_instance_count` | 4 | `0` | Instances de backend minimales. Augmentez à 1 pour la collaboration en temps réel. |
| `max_instance_count` | 4 | `1` | Instances de backend maximales. |
| `container_port` | 4 | `6060` | Port backend Penpot. Ne pas modifier. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | 4 | `3600` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | 4 | `true` | Se connecte via le socket Unix du proxy d'authentification Cloud SQL. |
| `container_protocol` | 4 | `'http1'` | Définissez `'h2c'` pour le multiplexage WebSocket HTTP/2. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir les images dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Allocation de trafic Canary/blue-green. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `penpot_flags` | 5 | `'enable-registration enable-login disable-demo-users'` | Indicateurs de fonctionnalités Penpot. |
| `jvm_max_heap` | 5 | `'1g'` | Tas maximal de la JVM. ~50 % de `memory_limit`. |
| `jvm_min_heap` | 5 | `'512m'` | Tas initial de la JVM. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte brut. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence de notification de rotation de Secret Manager. |
| `enable_auto_password_rotation` | 6 | `false` | Rotation automatique des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 6 | `90` | Secondes après la rotation avant de redémarrer les services. |
| `smtp_enabled` | 7 | `false` | Active l'e-mail SMTP. Requis pour les invitations et les réinitialisations de mot de passe. |
| `smtp_from` | 7 | `""` | Adresse e-mail de l'expéditeur. |
| `smtp_reply_to` | 7 | `""` | Adresse e-mail de réponse. |
| `smtp_host` | 7 | `""` | Nom d'hôte du serveur SMTP. |
| `smtp_port` | 7 | `587` | Port SMTP. |
| `smtp_username` | 7 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_use_tls` | 7 | `true` | Activer STARTTLS. |
| `smtp_use_ssl` | 7 | `false` | Activer SSL/TLS. |
| `ingress_settings` | 8 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 8 | `'PRIVATE_RANGES_ONLY'` | Routage de sortie VPC. |
| `enable_iap` | 8 | `false` | Active IAP sur le service Cloud Run. |
| `iap_authorized_users` | 8 | `[]` | Utilisateurs/comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | 8 | `[]` | Groupes Google ayant accès à IAP. |
| `backup_schedule` | 9 | `'0 2 * * *'` | Expression Cron pour les sauvegardes automatisées. |
| `backup_retention_days` | 9 | `7` | Jours de rétention des fichiers de sauvegarde. |
| `enable_backup_import` | 9 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 9 | `'gcs'` | `'gcs'` ou `'gdrive'`. |
| `backup_uri` | 9 | `""` | URI GCS complet ou ID de fichier Google Drive. |
| `backup_format` | 9 | `'sql'` | Format de sauvegarde. |
| `enable_cicd_trigger` | 10 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 10 | `""` | URL HTTPS complète de GitHub. |
| `github_token` | 10 | `""` | PAT GitHub. Sensible. |
| `github_app_installation_id` | 10 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 10 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 10 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 10 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy. |
| `enable_binary_authorization` | 10 | `false` | Applique l'attestation d'image. |
| `enable_custom_sql_scripts` | 11 | `false` | Exécute des scripts SQL depuis GCS. |
| `custom_sql_scripts_bucket` | 11 | `""` | Bucket GCS pour les scripts SQL. |
| `custom_sql_scripts_path` | 11 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 11 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `create_cloud_storage` | 12 | `true` | Définissez `false` pour ignorer la création de buckets supplémentaires. |
| `storage_buckets` | 12 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 12 | `true` | Provisionne un stockage partagé NFS. |
| `nfs_mount_path` | 12 | `'/mnt/nfs'` | Chemin de montage NFS du conteneur. |
| `nfs_instance_name` | 12 | `""` | Nom de la VM NFS existante. |
| `nfs_instance_base_name` | 12 | `'app-nfs'` | Nom de base pour la VM NFS intégrée. |
| `gcs_volumes` | 12 | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` | 12 | `false` | Clé KMS CMEK pour les buckets de stockage. |
| `enable_artifact_registry_cmek` | 12 | `false` | CMEK pour les images Artifact Registry. |
| `database_type` | 13 | `'POSTGRES_15'` | Moteur Cloud SQL. Ne pas modifier. |
| `db_name` | 13 | `'penpot'` | Nom de la base de données PostgreSQL. Immuable. |
| `db_user` | 13 | `'penpot'` | Utilisateur de l'application PostgreSQL. Immuable. |
| `database_password_length` | 13 | `32` | Longueur du mot de passe auto-généré. |
| `enable_cloud_armor` | 14 | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | 14 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 14 | `[]` | Domaines personnalisés avec SSL géré par Google. |
| `enable_cdn` | 14 | `false` | Active Cloud CDN sur l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 14 | `7` | Nombre maximal d'images Artifact Registry à conserver. |
| `delete_untagged_images` | 14 | `true` | Supprimer les images orphelines d'Artifact Registry. |
| `image_retention_days` | 14 | `30` | Jours avant que les images ne soient éligibles à la suppression. |
| `initialization_jobs` | 15 | `[]` | Jobs Cloud Run ponctuels. Laissez vide — Penpot gère ses propres migrations. |
| `cron_jobs` | 15 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 16 | Sonde TCP, port 6060, 40 tentatives | Sonde de démarrage TCP. |
| `liveness_probe` | 16 | `{ enabled=false }` | Désactivé — Cloud Run ne prend pas en charge la vivacité TCP. |
| `startup_probe_config` | 16 | `{ enabled=true, type="TCP", timeout_seconds=240 }` | Sonde de démarrage de l'équilibreur de charge. |
| `health_check_config` | 16 | `{ enabled=true, type="HTTP", path="/api/health" }` | Sonde de vivacité HTTP. |
| `uptime_check_config` | 16 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | 16 | `[]` | Règles d'alerte de métriques Cloud Monitoring. |
| `enable_redis` | 17 | `true` | Redis pour le pub/sub WebSocket. Obligatoire pour les multi-instances. |
| `redis_host` | 17 | `""` | Nom d'hôte/IP Redis. Par défaut, l'IP du serveur NFS. |
| `redis_port` | 17 | `'6379'` | Port TCP Redis. |
| `redis_auth` | 17 | `""` | Mot de passe d'authentification Redis. Sensible. |
| `enable_vpc_sc` | 18 | `false` | Application du périmètre VPC-SC. |
| `vpc_cidr_ranges` | 18 | `[]` | Plages CIDR VPC-SC. |
| `vpc_sc_dry_run` | 18 | `true` | Journaliser les violations sans bloquer. |
| `organization_id` | 18 | `""` | ID d'organisation GCP pour VPC-SC. |
| `enable_audit_logging` | 18 | `false` | Journaux d'audit Cloud détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run backend Penpot. |
| `backend_url` | URL publique du service Cloud Run backend. |
| `frontend_url` | URL publique du service Cloud Run frontend (nginx) — l'URL que les utilisateurs ouvrent. |
| `exporter_url` | URL publique du service Cloud Run d'exportation. |
| `service_location` | Région GCP du déploiement. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL 15. |
| `database_name` | Nom de la base de données de l'application Penpot. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application Penpot. |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (y compris `penpot-assets`). |
| `container_image` | Image conteneur utilisée pour le déploiement backend. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Penpot ne prend en charge que PostgreSQL. Toute autre valeur bloque le backend au démarrage. |
| `container_protocol` | `"h2c"` pour le multijoueur (valeur par défaut du module `"http1"`) | **Critique** | Sous `"http1"`, le multiplexage WebSocket est indisponible et la collaboration en temps réel se dégrade. Les conceptions peuvent toujours être enregistrées, mais l'édition multijoueur peut être non fonctionnelle. |
| `min_instance_count` | `1` pour la collaboration active (valeur par défaut du module `0`) | **Élevé** | Sous la mise à l'échelle à zéro, les sessions WebSocket actives sont terminées et tous les collaborateurs sont déconnectés. Les démarrages à froid de la JVM entraînent des retards de reconnexion de 30 à 60 secondes. |
| `redis_host` | `""` (résolution automatique vers l'IP NFS) | **Élevé** | Si `enable_nfs = false` et `redis_host` est également vide, le backend ne peut pas se connecter à Redis et échouera à démarrer la collaboration multi-instances. |
| `enable_redis` | `true` | **Élevé** | La désactivation de Redis interrompt la collaboration en temps réel sous tout équilibrage de charge. Les déploiements à instance unique survivent sans Redis, mais la mise à l'échelle devient impossible. |
| `jvm_max_heap` | `"1g"` | **Élevé** | Doit être défini en dessous de `memory_limit`. Définir `jvm_max_heap = "2g"` sur un conteneur `memory_limit = "2Gi"` ne laisse aucune marge pour la mémoire hors tas de la JVM, ce qui provoque des OOMKill. Un ratio sûr est de 50 % de `memory_limit`. |
| `memory_limit` | `"2Gi"` | **Élevé** | La JVM de Penpot nécessite une marge pour la mémoire hors tas, les tampons NIO et le metaspace. Réduire en dessous de `1Gi` provoque des OOMKill fréquents sous des charges de travail réelles. |
| `db_name` | `"penpot"` | **Critique** | Immuable après le déploiement. Toute modification entraîne la recréation de la base de données par Terraform, détruisant toutes les conceptions, fichiers et données d'équipe de Penpot. |
| `db_user` | `"penpot"` | **Critique** | Immuable après le déploiement. Toute modification recrée l'utilisateur Cloud SQL et interrompt toutes les connexions à la base de données. |
| `penpot_flags` | `"enable-registration enable-login disable-demo-users"` | **Moyen** | Laisser `enable-registration` actif sur un déploiement public permet à quiconque de créer un compte. Utilisez `disable-registration` pour les déploiements en équipe fermée et invitez les utilisateurs par e-mail. |
| `smtp_enabled` | `false` | **Élevé** | Avec SMTP désactivé, Penpot ne peut pas envoyer d'invitations d'équipe ni d'e-mails de réinitialisation de mot de passe. Les nouveaux membres de l'équipe ne peuvent être ajoutés par un administrateur que par création directe de compte. |
| `application_domains` | `[]` | **Moyen** | Sans domaine personnalisé, le `PENPOT_PUBLIC_URI` est défini sur l'URL `*.run.app` prédite. Si les utilisateurs accèdent à Penpot via un domaine personnalisé sans mettre à jour `PENPOT_PUBLIC_URI`, les liens des e-mails d'invitation pointent vers la mauvaise URL. |
| `backup_retention_days` | `7` | **Moyen** | Insuffisant pour les équipes de conception actives. Augmenter à plus de 30 jours. Une semaine de conceptions et de fichiers peut représenter un travail créatif important. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, le frontend et l'API Penpot sont exposés directement à Internet. Les règles WAF protègent contre les attaques web courantes sur l'API de conception. |
| `timeout_seconds` | `3600` | **Faible** | Réduire en dessous de 300 secondes peut entraîner l'expiration des opérations d'exportation PDF/PNG volumineuses en cours d'exportation, renvoyant une erreur au concepteur. |

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération d'adresse IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur similaire à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve les adresses IPv4 sans serveur sur le sous-réseau VPC de manière asynchrone après la suppression d'un service Cloud Run. Ces adresses sont libérées environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** Attendez 20 à 30 minutes après la tentative de destruction initiale, puis réexécutez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

## Guides associés {#related-guides}

- [Lab pratique : Penpot sur Cloud Run](../labs/Penpot_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module Penpot GKE — Guide de configuration](Penpot_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Penpot](Penpot_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md), [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) dans la solution **Conception et collaboration visuelle**.
