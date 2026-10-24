---
title: "Directus sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Directus sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Directus_GKE.md @ e69407af sha256:55cb3022b832 -->

# Directus sur GKE Autopilot {#directus-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_GKE.png" alt="Directus sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Directus est un CMS headless open source et une plateforme Backend-as-a-Service (BaaS) qui enveloppe toute base de données SQL avec des API REST et GraphQL auto-générées et une application d'administration sans code. Ce module déploie Directus sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Directus et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Directus sur RAD, et comment cela se compare {#what-directus-costs-on-rad-and-how-that-compares}

**Le module Directus sur GKE Autopilot de RAD coûte environ 142,62 $ US par mois sans licence d'hébergement séparée.** Cela se compare à 499 $ US par mois (facturé annuellement) ou 599 $ US par mois (facturé mensuellement) pour le plan Team hébergé par Directus Cloud. Un serveur auto-géré est moins cher en espèces, mais vous gérez alors vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Pour le coût le plus bas, le [guide Cloud Run](Directus_CloudRun.md) exécute le même Directus pour environ 82,03 $ US par mois. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 142,62 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **142,62 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **112 crédits par jour**, soit environ 3 360 par mois (environ 336 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 GB, zonal, 10 GB SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 142,62 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Directus Cloud, plan Team | 499 $ US (annuel) – 599 $ US (mensuel) | Directus |
| **RAD, GKE Autopilot, votre propre projet** | **Environ 142,62 $ US** | Automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **Environ 336 $ US** | RAD |

- Le plan Team de Directus Cloud est tarifé par **projet**, et non par utilisateur, et coûte plusieurs fois le coût de RAD pour le même Directus Core open source — le niveau Core gratuit de Directus est auto-hébergé, ce que RAD automatise pour vous.
- Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne : la base de données de RAD est Cloud SQL avec des sauvegardes quotidiennes et une récupération ponctuelle, et les secrets résident dans Secret Manager. Sur votre propre serveur, ou un VPS nu, chacun de ces éléments est un travail que vous faites vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Directus s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Directus si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, la VM NFS ou le pod GKE un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Directus, contre les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 142,62 $ US.** Déployez Directus, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles Directus était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD ne gère que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Directus. La suppression permet d'économiser de l'argent une fois que Directus resterait inutilisé pendant environ **2 jours ou plus** dans votre propre projet (environ 4,75 $ US par jour), ou environ **1 jour ou plus** dans un projet géré par RAD (112 crédits par jour).
- **Supprimez tout ce que Directus utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc les supprimer alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Directus.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou dans un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous devez saisir à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Directus dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Directus pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes et la fenêtre de pause/restauration. [Tarification Directus Cloud](https://directus.com/pricing) pour les chiffres du plan Team ;

## 1. Vue d'ensemble {#1-overview}

Directus fonctionne comme une charge de travail Node.js. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Directus code en dur `DB_CLIENT = "pg"` |
| Fichiers partagés | Filestore (NFS) | Actifs et médias téléchargés partagés entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket de téléchargement dédié ; GCS est le pilote de stockage Directus par défaut |
| Cache | Redis | Activé par défaut ; utilise l'adresse IP de l'hôte NFS lorsqu'aucun hôte explicite n'est défini |
| Secrets | Secret Manager | KEY, SECRET, ADMIN_PASSWORD et URL de connexion REDIS auto-générés |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** Directus code en dur `DB_CLIENT = "pg"`. Le passage à MySQL ou `NONE` empêche le démarrage.
- **GCS est le pilote de stockage de fichiers par défaut.** `Directus_Common` injecte automatiquement `STORAGE_GCS_DRIVER`, `STORAGE_GCS_BUCKET` et `STORAGE_LOCATIONS = "gcs"`, de sorte que tous les téléchargements vont vers le bucket Cloud Storage dédié.
- **L'auto-migration et le bootstrap s'exécutent à chaque démarrage.** `AUTO_MIGRATE = "true"` applique toutes les migrations de schéma de base de données en attente au démarrage. `BOOTSTRAP = "true"` initialise l'utilisateur administrateur et les collections système au premier démarrage — les deux sont idempotents.
- **La mise à l'échelle à zéro est la valeur par défaut** (`min_instance_count = 0`). Directus utilise des sessions basées sur Redis, de sorte que les démarrages à froid sont acceptables pour les déploiements non critiques en termes de latence. Définissez `min_instance_count = 1` pour éliminer les démarrages à froid en production.
- **La KEY et le SECRET de Directus** sont générés automatiquement et stockés dans Secret Manager. Leur rotation après le premier déploiement invalide toutes les sessions actives et les JWT.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Directus {#a-gke-autopilot--the-directus-workload}

Les pods Directus sont planifiés sur Autopilot, qui facture le CPU/la mémoire réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Directus pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Manually verify the Directus health endpoint from within the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- curl -sf http://localhost:8055/server/ping
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Directus stocke toutes les données d'application dans une instance Cloud SQL gérée pour PostgreSQL 15. Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** via un socket Unix. Lors du premier déploiement, un job `db-init` crée la base de données d'application, l'utilisateur, accorde les privilèges et installe les extensions `uuid-ossp` et `postgis`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les actifs téléchargés sont écrits dans un partage **Filestore (NFS)** monté dans chaque pod afin que toutes les répliques voient les mêmes fichiers. Un bucket de téléchargement **Cloud Storage** dédié est également provisionné ; Directus est configuré pour utiliser GCS comme pilote de stockage principal via `STORAGE_GCS_DRIVER = "gcs"`.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket de téléchargement.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache des réponses API de Directus et l'état de la limitation de débit. Lorsqu'aucun hôte Redis explicite n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison Redis par défaut. L'URL de connexion Redis complète (y compris tout mot de passe d'authentification) est stockée en tant que secret Secret Manager et injectée en tant que variable d'environnement `REDIS`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  # From a host with network access:
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS is injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Quatre secrets sont générés et stockés automatiquement : `KEY` (chiffrement des données), `SECRET` (signature JWT), `ADMIN_PASSWORD` (compte administrateur initial) et `REDIS` (URL de connexion Redis lorsque Redis est activé). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password:
  gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"
  # Retrieve the DB password secret name from Outputs, then:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Le nom `database_password_secret` se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Directus {#3-directus-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` s'exécute à chaque apply (`execute_on_apply = true`). Il crée l'utilisateur de la base de données Directus avec le mot de passe généré, crée la base de données `directus`, installe les extensions `uuid-ossp` et `postgis` (l'échec de PostGIS n'est pas fatal) et accorde tous les privilèges. Le job est idempotent.
- **Bootstrap au premier démarrage.** `BOOTSTRAP = "true"` initialise l'utilisateur administrateur initial et les collections système Directus au premier démarrage. L'e-mail de l'administrateur est par défaut `admin@example.com` — **remplacez-le via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement.**
- **Migrations à chaque démarrage.** `AUTO_MIGRATE = "true"` fait en sorte que Directus exécute `database migrate:latest` à chaque démarrage de pod, de sorte que la mise à niveau `application_version` applique automatiquement les modifications de schéma.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent `/server/ping`, le point de terminaison de vivacité public et non authentifié de Directus (renvoie `pong`/200 dès que le serveur écoute) — `/server/health` nécessite une authentification administrateur et renverrait 403 pour une sonde non authentifiée. La sonde de démarrage autorise jusqu'à 300 secondes (`failure_threshold = 10`, `period_seconds = 30`) pour s'adapter à la configuration de la base de données au premier démarrage.
- **Rotation de KEY et SECRET.** La rotation du secret `KEY` invalide immédiatement toutes les sessions utilisateur actives. La rotation de `SECRET` invalide tous les JWT émis. Ne faites jamais pivoter l'un ou l'autre sans une fenêtre de maintenance planifiée et une notification client.
- **Connexion administrateur.** Récupérez le mot de passe administrateur généré à partir de Secret Manager (voir §2.E). L'e-mail administrateur par défaut est `admin@example.com`, sauf s'il est remplacé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Directus sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. Ne pas modifier après le premier déploiement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `directus` | Nom de base des ressources. Ne pas modifier après le premier déploiement — intégré dans les ID de secret de Secret Manager. |
| `application_display_name` | `Directus CMS` | Nom convivial affiché dans la console. |
| `application_version` | `11.1.0` | Tag de version de l'image Directus ; incrémenter pour déployer une nouvelle version. Épingler à un tag spécifique — éviter `latest` en production. |
| `description` | `Directus - Open Source Headless CMS and Backend-as-a-Service` | Annotation de description de la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure (Cloud SQL, stockage, secrets) sans déployer la charge de travail. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour une génération d'API réactive. |
| `memory_limit` | `2Gi` | Mémoire par pod ; 2 GiB minimum — augmenter pour les grands schémas ou les transformations d'images. |
| `min_instance_count` | `0` | Répliques minimales. Définissez `1` pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `3` | Répliques maximales (plafond de l'autoscaler). |
| `container_port` | `8055` | Port d'écoute par défaut de Directus. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Remplacez `ADMIN_EMAIL` ici avant le premier déploiement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `workload_type` | `Deployment` | `Deployment` (sans état) ou `StatefulSet`. Pour la plupart des déploiements Directus, conservez la valeur par défaut et utilisez `enable_nfs = true` pour les actifs partagés. |
| `session_affinity` | `ClientIP` | Routage persistant. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Activer les modèles PVC par pod dans la spécification StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC de pod. Ne peut pas être diminuée après le provisionnement. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC par pod est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_headless_service` | `true` | Créer un service sans tête pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `OrderedReady` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | `RollingUpdate` ou `OnDelete`. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/server/ping`, HTTP, failure_threshold=10 | Sonde de démarrage Kubernetes. Permet jusqu'à 300 s pour les migrations au premier démarrage. |
| `liveness_probe` | `/server/ping`, HTTP | Sonde de vivacité Kubernetes ; le pod est redémarré après 3 échecs consécutifs. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré fourni par `Directus_Common`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par exemple, purge du cache, synchronisation des données). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Directus. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les actifs téléchargés (garder activé pour les répliques multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets supplémentaires dans `storage_buckets`. Le bucket de téléchargement de `Directus_Common` est toujours provisionné. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket de téléchargement auto-provisionné. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache et la limitation de débit. |
| `redis_host` | `""` | Laisser vide pour utiliser l'adresse IP de l'hôte NFS ; définir explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). L'URL de connexion complète est stockée dans Secret Manager. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Directus nécessite PostgreSQL. Ne pas modifier. |
| `db_name` | `directus` | Nom de la base de données PostgreSQL. Ne pas modifier après le premier déploiement. |
| `db_user` | `directus` | Utilisateur de l'application. Ne pas modifier après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_postgres_extensions` | `true` | Installer `uuid-ossp` (et éventuellement `postgis`) via `db-init`. |
| `postgres_extensions` | `["uuid-ossp"]` | Extensions à installer. Ajouter `"postgis"` pour le support géospatial. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définir `enable_backup_import = false` immédiatement après une restauration réussie. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Directus. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN via l'API Gateway. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). Utiliser `vpc_sc_dry_run = true` en premier. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Directus. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Directus nécessite PostgreSQL ; le passage à MySQL ou `NONE` empêche le démarrage et orpheline la base de données existante. |
| `application_name` | défini une fois | Critique | Intégré dans les ID de secrets Secret Manager (KEY, SECRET, ADMIN_PASSWORD). Le modifier recrée tous les secrets — toutes les sessions actives et les JWT sont immédiatement invalidés. |
| `tenant_id` | défini une fois | Critique | Le modifier après le premier déploiement orpheline l'instance Cloud SQL et génère une nouvelle base de données vide ainsi que de nouvelles KEY/SECRET, invalidant toutes les sessions. |
| `KEY` / `SECRET` secrets | auto-générés, ne jamais les faire pivoter de manière occasionnelle | Critique | La rotation de KEY déconnecte tous les utilisateurs. La rotation de SECRET invalide tous les jetons API. Ne faire pivoter que pendant une fenêtre de maintenance planifiée. |
| `ADMIN_EMAIL` variable d'environnement | une adresse e-mail réelle | Élevé | La valeur par défaut `admin@example.com` crée le compte administrateur avec un e-mail facile à deviner. À remplacer via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires (`4Gi`) | Critique | Les entiers bruts (par exemple, `"4"`) sont lus comme des octets — bloque définitivement la planification des pods. |
| `enable_nfs` | `true` | Élevé | Sans NFS partagé, les actifs téléchargés écrits par un pod sont invisibles pour les autres et perdus au redémarrage (sauf si GCS Fuse est utilisé exclusivement). |
| `enable_redis` | `true` pour multi-réplica | Élevé | Sans Redis, chaque pod a un cache isolé ; la limitation de débit est par pod et la mise en cache de Directus ne fonctionne pas entre les réplicas. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison Redis valide si Redis est activé, NFS est désactivé et aucun hôte n'est défini. |
| `startup_probe.failure_threshold` | `10` ou plus élevé lors du premier déploiement | Élevé | Trop faible : les migrations Directus peuvent prendre 1 à 3 minutes sur une base de données vierge ; le pod est tué avant la fin des migrations, provoquant une boucle de redémarrage. |
| `enable_backup_import` | `false` après restauration | Élevé | Laisser `true` réexécute l'importation à chaque apply, écrasant les données en direct avec la sauvegarde obsolète. |
| `memory_limit` | `2Gi` | Élevé | Une mémoire insuffisante provoque des arrêts OOM (Out Of Memory) lors du chargement du schéma ou de la transformation d'images. |
| `min_instance_count` | `1` pour la production | Moyen | `0` en production provoque des démarrages à froid de 20 à 40 secondes lors de la première requête API après une période d'inactivité. |
| `enable_pod_disruption_budget` + `pdb_min_available` | laisser de la marge | Moyen | `pdb_min_available = "1"` avec `min_instance_count = 1` bloque définitivement les drains de nœuds. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'interface d'administration | Moyen | L'interface utilisateur d'administration est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | commencer avec `vpc_sc_dry_run = true` | Critique | L'activation de l'application sans le compte de service dans le niveau d'accès bloque simultanément Cloud SQL, Secret Manager et Artifact Registry. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Directus partagée avec la variante Cloud Run est décrite dans **[Directus_Common](Directus_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Directus sur GKE Autopilot](../labs/Directus_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Directus sur Cloud Run](Directus_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Directus Common — Configuration d'application partagée](Directus_Common.md) — la configuration partagée par les deux cibles de déploiement.
