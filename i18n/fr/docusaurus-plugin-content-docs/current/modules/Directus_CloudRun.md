---
title: "Directus sur Cloud Run"
description: "Référence de configuration pour le déploiement de Directus sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Directus_CloudRun.md @ 1665a43e sha256:d0777294b4c9 -->

# Directus sur Cloud Run {#directus-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_CloudRun.png" alt="Directus sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Directus est une plateforme open source de CMS headless et de Backend-as-a-Service (BaaS) qui encapsule toute base de données SQL avec des API REST et GraphQL auto-générées et une application d'administration sans code. Ce module déploie Directus sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Directus et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Directus sur RAD, et comment cela se compare {#what-directus-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Directus sur RAD coûte environ 82,03 $ US par mois sans licence d'hébergement séparée.** Cela se compare à 499 $ US par mois (facturé annuellement) ou 599 $ US par mois (facturé mensuellement) pour le plan Team hébergé de Directus Cloud. Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. GKE Autopilot convient aux instances Directus qui doivent rester actives en permanence ou s'adapter à plusieurs pods ; pour le coût le plus bas, ce module Cloud Run vous offre déjà l'option la moins chère — consultez le [guide GKE](Directus_GKE.md) si vous avez besoin de l'autre option. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 82,03 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **82,03 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 82,03 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Directus Cloud, plan Team | 499 $ US (annuel) – 599 $ US (mensuel) | Directus |
| **RAD, Cloud Run, votre propre projet** | **Environ 82,03 $ US** | Automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 96 $ US** | RAD |

- Le plan Team de Directus Cloud est tarifé par **projet**, et non par utilisateur, et commence à plusieurs fois le coût du projet propre à RAD pour le même Directus Core open source — le niveau Core gratuit de Directus est auto-hébergé, ce que RAD automatise pour vous.
- Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne : la base de données de RAD est Cloud SQL avec des sauvegardes quotidiennes et une récupération à un point dans le temps, et les secrets résident dans Secret Manager. Sur votre propre serveur, ou un VPS nu, chacune de ces tâches est un travail que vous faites vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Directus s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Directus dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Directus, contre les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 82,03 $ US.** Déployez Directus, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles Directus était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le workflow de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Directus. La suppression permet d'économiser de l'argent une fois que Directus resterait inutilisé pendant environ **4 jours ou plus** dans votre propre projet (environ 2,73 $ US par jour), ou environ **3 jours ou plus** dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Directus utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc les supprimer alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Directus.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou dans un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Directus dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Directus pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes et la fenêtre de pause/restauration. [Tarification Directus Cloud](https://directus.com/pricing) pour les chiffres du plan Team ;

## 1. Vue d'ensemble {#1-overview}

Directus s'exécute en tant que conteneur Node.js sur Cloud Run entièrement géré. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Sans serveur, s'adapte automatiquement à zéro entre les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Directus code en dur `DB_CLIENT = "pg"` |
| Fichiers partagés | Filestore (NFS) | Actifs et médias téléchargés partagés entre toutes les instances |
| Stockage d'objets | Cloud Storage | Un bucket de téléchargement dédié ; GCS est le pilote de stockage Directus par défaut |
| Cache | Redis | Activé par défaut ; utilise l'IP de l'hôte NFS par défaut si aucun hôte explicite n'est défini |
| Secrets | Secret Manager | KEY, SECRET, ADMIN_PASSWORD et URL de connexion REDIS auto-générés |
| Ingress | Cloud Load Balancing | HTTPS via NEG sans serveur + domaine personnalisé facultatif et certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** Directus code en dur `DB_CLIENT = "pg"`. Le passage à MySQL ou `NONE` empêche le démarrage.
- **GCS est le pilote de stockage de fichiers par défaut.** `Directus_Common` injecte automatiquement `STORAGE_GCS_DRIVER`, `STORAGE_GCS_BUCKET` et `STORAGE_LOCATIONS = "gcs"`, de sorte que tous les téléchargements vont vers le bucket Cloud Storage dédié.
- **L'auto-migration et le bootstrap s'exécutent à chaque démarrage.** `AUTO_MIGRATE = "true"` applique toutes les migrations de schéma de base de données en attente au démarrage. `BOOTSTRAP = "true"` initialise l'utilisateur administrateur et les collections système au premier démarrage — les deux sont idempotents.
- **La mise à l'échelle à zéro est la valeur par défaut** (`min_instance_count = 0`). Directus utilise des sessions basées sur Redis, de sorte que les démarrages à froid sont acceptables pour les déploiements non critiques en termes de latence. Définissez `min_instance_count = 1` pour éliminer les démarrages à froid en production.
- **La KEY et le SECRET de Directus** sont générés automatiquement et stockés dans Secret Manager. Leur rotation après le premier déploiement invalide toutes les sessions actives et les JWT.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `SERVICE_NAME` sont définis. Le nom du service et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Service Cloud Run — la charge de travail Directus {#a-cloud-run-service--the-directus-workload}

Directus s'exécute en tant que service Cloud Run unique. Chaque nouveau déploiement crée une nouvelle révision ; la gestion du trafic contrôle quelle révision reçoit le trafic.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, les répartitions de trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  # Stream live logs:
  gcloud run services logs tail "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  # Verify the health endpoint manually:
  curl -sf "$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" --format='value(status.url)')/server/ping"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour l'autoscaling, la concurrence, les environnements d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Directus stocke toutes les données de l'application dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les instances se connectent par défaut via **TCP** (connecteur Cloud SQL, pas de socket Unix par défaut sur Cloud Run). Un job `db-init` s'exécute à chaque apply (idempotent) et crée la base de données de l'application, l'utilisateur, accorde les privilèges et installe l'extension `uuid-ossp`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les ressources téléchargées sont écrites sur un partage **Filestore (NFS)** monté dans chaque instance afin que tous les réplicas voient les mêmes fichiers. Un bucket de téléchargement **Cloud Storage** dédié est également provisionné ; Directus est configuré pour utiliser GCS comme pilote de stockage principal via `STORAGE_GCS_DRIVER = "gcs"`.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket de téléchargement.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache des réponses API et l'état de limitation de débit de Directus. Lorsqu'aucun hôte Redis explicite n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison Redis par défaut. L'URL de connexion Redis complète (y compris tout mot de passe d'authentification) est stockée en tant que secret Secret Manager et injectée en tant que variable d'environnement `REDIS`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  # Confirm REDIS is injected into the Cloud Run service environment:
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" \
    --format='yaml(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Quatre secrets sont générés et stockés automatiquement : `KEY` (chiffrement des données), `SECRET` (signature JWT), `ADMIN_PASSWORD` (compte administrateur initial) et `REDIS` (URL de connexion Redis lorsque Redis est activé). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password:
  gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"
  # Retrieve the DB password:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Le nom `database_password_secret` se trouve dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle d'injection de secrets.

### F. Réseau et ingress {#f-networking--ingress}

Le service Cloud Run est précédé d'un groupe de points de terminaison réseau sans serveur attaché à un équilibreur de charge Cloud global. HTTPS est géré automatiquement. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée.

- **Console :** Services réseau → Équilibrage de charge ; Cloud Run → service → onglet Réseau.
- **CLI :**
  ```bash
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés, Cloud CDN et les détails de l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des conteneurs sont acheminées vers Cloud Logging. Les métriques Cloud Run et les tests de disponibilité facultatifs sont acheminés vers Cloud Monitoring.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE_NAME"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Directus {#3-directus-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` s'exécute à chaque apply (`execute_on_apply = true`). Il crée l'utilisateur de la base de données Directus avec le mot de passe généré, crée la base de données `directus`, installe l'extension `uuid-ossp` et accorde tous les privilèges. Le job est idempotent.
- **Bootstrap au premier démarrage.** `BOOTSTRAP = "true"` initialise l'utilisateur administrateur initial et les collections système de Directus au premier démarrage. L'e-mail de l'administrateur est par défaut `admin@example.com` — **remplacez-le via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement.**
- **Migrations à chaque démarrage.** `AUTO_MIGRATE = "true"` fait en sorte que Directus exécute `database migrate:latest` à chaque démarrage d'instance, de sorte que la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Sonde de santé.** La sonde de démarrage cible `/server/ping` avec un délai initial de 30 secondes et un seuil d'échec généreux (`failure_threshold = 10`, `period_seconds = 20`) pour tenir compte de la configuration de la base de données au premier démarrage. La sonde de vivacité cible également `/server/ping`.
- **Connexions de base de données TCP par défaut.** Contrairement à la variante GKE (qui utilise un socket Unix via le sidecar Auth Proxy), la variante Cloud Run se connecte à Cloud SQL via TCP en utilisant le connecteur Cloud SQL (`enable_cloudsql_volume = false` par défaut). Le trafic sortant ne transite que vers des adresses IP privées (`vpc_egress_setting = "PRIVATE_RANGES_ONLY"`).
- **Rotation de KEY et SECRET.** La rotation du secret `KEY` invalide immédiatement toutes les sessions utilisateur actives. La rotation de `SECRET` invalide tous les JWT émis. Ne faites jamais pivoter l'un ou l'autre sans une fenêtre de maintenance planifiée et une notification client.
- **Connexion administrateur.** Récupérez le mot de passe administrateur généré depuis Secret Manager (voir §2.E). L'e-mail administrateur par défaut est `admin@example.com` sauf s'il est remplacé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Directus sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service Cloud Run et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Ne pas modifier après le premier déploiement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `directus` | Nom de base des ressources. Ne pas modifier après le premier déploiement — intégré dans les ID de secrets Secret Manager. |
| `display_name` | `Directus CMS` | Nom convivial affiché dans la console. |
| `application_version` | `11.1.0` | Tag de version de l'image Directus ; incrémenter pour déployer une nouvelle version. Épingler à un tag spécifique — éviter `latest` en production. |
| `description` | `Directus - Open Source Headless CMS and Backend-as-a-Service` | Annotation de description du service. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure (Cloud SQL, stockage, secrets) sans déployer le service Cloud Run. |
| `cpu_limit` | `1000m` | vCPU par instance ; 1 vCPU convient aux charges de travail légères. |
| `memory_limit` | `1Gi` | Mémoire par instance ; par défaut 1 GiB pour une utilisation légère/typique (observé ~150Mi) — augmenter à 2 GiB pour la production ou les grands schémas/transformations d'images. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — sûr pour le mode requête/réponse par défaut de Directus. Définissez `true` uniquement si vous activez les abonnements en temps réel/WebSocket ou les flux planifiés qui doivent s'exécuter sans requête entrante. |
| `min_instance_count` | `0` | Instances minimales. Définissez `1` pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `1` | Plafond de concurrence maximal. Augmenter pour le trafic de production. |
| `container_port` | `8055` | Port d'écoute par défaut de Directus. |
| `execution_environment` | `gen2` | Environnement d'exécution Cloud Run de deuxième génération (recommandé). |
| `enable_cloudsql_volume` | `false` | Connexion TCP par défaut ; définissez `true` pour activer le socket Unix via le sidecar Auth Proxy. |

### Groupe 5 — Ingress et IAP {#group-5--ingress--iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `"all"` (public) ou `"internal-and-cloud-load-balancing"` (privé). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic de plage privée via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Directus. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | _(valeurs par défaut SMTP)_ | Paramètres supplémentaires non secrets. La valeur par défaut inclut des variables d'espace réservé SMTP. **Remplacez `ADMIN_EMAIL` ici avant le premier déploiement.** |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définissez `enable_backup_import = false` immédiatement après une restauration réussie. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés et NFS {#group-9--custom-sql-scripts--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` | exécuter SQL depuis GCS | Voir [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | références à l'instance Filestore partagée | Définir lorsque l'instance Filestore n'a pas été créée par le même déploiement Services_GCP. |

### Groupe 10 — Cloud Armor, domaines et CDN {#group-10--cloud-armor-domains--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend de l'équilibreur de charge. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés — activer pour la production avec un vrai nom DNS. |
| `enable_cdn` | `false` | Activer Cloud CDN via l'équilibreur de charge. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets supplémentaires au-delà du bucket de téléchargement auto-provisionné. |
| `storage_buckets` | `[{ name_suffix = "data", location = "" }]` | Buckets GCS supplémentaires, en plus du bucket de téléchargement auto-provisionné de `Directus_Common`. |
| `enable_nfs` | `true` | Volume Filestore partagé pour les actifs téléchargés (garder activé pour les instances multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Directus nécessite PostgreSQL. Ne pas modifier. |
| `db_name` | `directus` | Nom de la base de données PostgreSQL. Ne pas modifier après le premier déploiement. |
| `db_user` | `directus` | Utilisateur de l'application. Ne pas modifier après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré fourni par `Directus_Common`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents (par exemple, purge du cache, synchronisation des données). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/server/ping`, HTTP, délai de 30 s, failure_threshold=10, période=20 s | Sonde de démarrage Cloud Run. Permet jusqu'à ~230 s pour les migrations au premier démarrage. |
| `liveness_probe` | `/server/ping`, HTTP, délai de 15 s | Instance redémarrée après 3 échecs consécutifs. |
| `uptime_check_config` | désactivé par défaut, chemin `/` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache et la limitation de débit. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP de l'hôte NFS ; définir explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). L'URL de connexion complète est stockée dans Secret Manager. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). Utiliser `vpc_sc_dry_run = true` en premier. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | L'URL HTTPS publique pour atteindre Directus. |
| `service_location` | Région où le service est déployé. |
| `stage_services` | URL de service par étape Cloud Deploy (lorsque le déploiement multi-étapes est activé). |
| `load_balancer_ip` | IP externe du frontend de l'équilibreur de charge. |
| `load_balancer_url` | URL HTTPS via l'équilibreur de charge (lorsqu'un domaine personnalisé ou une IP statique est utilisé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | Hôte de la base de données (sensible — renvoyé comme `(sensitive)` dans la sortie du plan). |
| `database_port` | Port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux et tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Directus nécessite PostgreSQL ; le passage à MySQL ou `NONE` empêche le démarrage et orpheline la base de données existante. |
| `application_name` | défini une fois | Critique | Intégré dans les ID de secrets Secret Manager (KEY, SECRET, ADMIN_PASSWORD). La modification recrée tous les secrets — toutes les sessions actives et les JWT sont immédiatement invalidés. |
| `tenant_id` | défini une fois | Critique | La modification après le premier déploiement orpheline l'instance Cloud SQL et génère une nouvelle base de données vide ainsi que de nouvelles KEY/SECRET, invalidant toutes les sessions. |
| `KEY` / `SECRET` secrets | auto-générés, ne jamais faire pivoter à la légère | Critique | La rotation de KEY déconnecte tous les utilisateurs. La rotation de SECRET invalide tous les jetons API. Ne faire pivoter que pendant une fenêtre de maintenance planifiée. |
| `ADMIN_EMAIL` variable d'environnement | une vraie adresse e-mail | Élevé | La valeur par défaut `admin@example.com` crée le compte administrateur avec un e-mail facile à deviner. Remplacer via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement. |
| `enable_nfs` | `true` | Élevé | Sans NFS partagé, les actifs téléchargés écrits par une instance sont invisibles pour les autres et perdus lors de la réduction d'échelle (sauf si GCS est utilisé exclusivement). |
| `enable_redis` | `true` pour multi-instance | Élevé | Sans Redis, chaque instance a un cache isolé ; la limitation de débit est par instance et la mise en cache de Directus ne fonctionne pas sur plusieurs réplicas. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison Redis valide si Redis est activé, NFS est désactivé et aucun hôte n'est défini. |
| `startup_probe.failure_threshold` | `10` au premier déploiement | Élevé | Trop faible : les migrations Directus peuvent prendre 1 à 3 minutes sur une base de données vierge ; l'instance est tuée avant la fin des migrations. |
| `enable_backup_import` | `false` après restauration | Élevé | Laisser `true` réexécute l'importation à chaque apply, écrasant les données en direct avec la sauvegarde obsolète. |
| `memory_limit` | `2Gi` | Élevé | Trop peu de mémoire provoque des arrêts OOM lors du chargement du schéma ou de la transformation d'images. |
| `min_instance_count` | `1` pour la production | Moyen | `0` en production provoque des démarrages à froid de 20 à 40 s lors de la première requête API après une période d'inactivité. |
| `max_instance_count` | mise à l'échelle pour le trafic | Moyen | `1` bloque la mise à l'échelle horizontale et provoque la mise en file d'attente des requêtes sous charge. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'interface d'administration | Moyen | L'interface utilisateur d'administration est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | commencer par `vpc_sc_dry_run = true` | Critique | L'activation de l'application sans le compte de service dans le niveau d'accès bloque simultanément Cloud SQL, Secret Manager et Artifact Registry. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Directus partagée avec la variante GKE est décrite dans **[Directus_Common](Directus_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Directus sur Cloud Run](../labs/Directus_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Directus sur GKE Autopilot](Directus_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Directus Common — Configuration d'application partagée](Directus_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Umami sur Google Cloud Run](Umami_CloudRun.md) dans la solution **Plateforme de contenu headless**.
