---
title: "Linkwarden sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Linkwarden sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Linkwarden_GKE.md @ e69407af sha256:88cb64774bae -->

# Linkwarden sur GKE Autopilot {#linkwarden-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Linkwarden_GKE.png" alt="Linkwarden sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Linkwarden est un gestionnaire de signets open source auto-hébergé qui va au-delà
de la simple sauvegarde de liens : chaque signet peut être automatiquement archivé
sous forme de capture d'écran pleine page, de PDF et d'instantané "monolithe"
en un seul fichier à l'aide d'un Chrome sans tête intégré, de sorte que vos liens
continuent de fonctionner même après que la page source ait changé ou disparu.
Ce module déploie Linkwarden sur **GKE Autopilot** sur la base de la
[fondation App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Linkwarden et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Coût de Linkwarden sur RAD et comparaison {#what-linkwarden-costs-on-rad-and-how-that-compares}

**Le module Linkwarden sur GKE Autopilot de RAD coûte environ 129 $ US par mois
dans un projet Google Cloud que vous possédez, plus des frais de module uniques
de 110 crédits (11,00 $ US).** GKE convient à Linkwarden fonctionnant aux côtés
d'autres charges de travail Kubernetes ; le [module Cloud Run](Linkwarden_CloudRun.md)
exécute le même Linkwarden pour environ 157 $ US par mois. Si vous n'en avez
besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et
restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 129 $ US
deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **129 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **101 crédits par jour**, soit environ 3030 par mois (environ 303 $ US au prix de la recharge, 242 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel.
Dans un projet géré par RAD, la base de données, le serveur de fichiers et le
réseau sont partagés par toutes les applications du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 129 $ US** |

### Comparaison {#how-it-compares}

- **Linkwarden Cloud** (3 $/utilisateur/mois, 2,25 $ annuellement, jusqu'à 30 000 liens/utilisateur — [linkwarden.app/pricing](https://linkwarden.app/pricing)) est moins cher en espèces pour la plupart des tailles d'équipe que l'auto-hébergement sur GKE ; l'intérêt de l'auto-hébergement est la souveraineté des données et l'absence de limite par lien, pas le prix.
- Un GCE e2-standard-2 (2 vCPU/8 Go, environ 49 $/mois) est la comparaison auto-gérée de taille plus proche, moins le Postgres géré, les sauvegardes et l'autoscaling de pods inclus par RAD.
- Ou consultez le [guide Cloud Run](Linkwarden_CloudRun.md) pour l'option moins coûteuse.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Linkwarden s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.**
Cela convient bien mieux à Linkwarden dont vous n'avez besoin qu'occasionnellement
— un projet de cours, une démo, une évaluation de courte durée — que de le faire
fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime
  pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours.
  Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente.
  Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL ou
  le propre calcul de Linkwarden un par un — l'ensemble du projet, et tout ce
  qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  réactiver le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est
  revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
  les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais à nouveau les frais de
  module. Pour Linkwarden derrière un petit Services_GCP et Project_GCP, cela
  représente **une poignée de crédits (moins de 1 $ US)** au total, contre les
  115 crédits que coûte un redéploiement complet.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet
  que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde
  de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour
  le niveau sandbox qui convient à la plupart des utilisations d'étude et de démo).
  Google indique que la plupart des services fonctionnent à nouveau pleinement
  dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  nocturnes de Linkwarden sont écrites dans un bucket à l'intérieur du projet,
  et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage,
  il est donc très probable qu'il disparaisse dès que vous supprimez le projet
  — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
  personnalisé Linkwarden et que vous souhaitez conserver ce travail, copiez une
  sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
  supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à
l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet
géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le
redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 115 crédits (11,50 $ US), car RAD recrée le projet et les services
  partagés avant Linkwarden. La suppression ne permet d'économiser de l'argent
  que si Linkwarden devait rester inutilisé pendant environ trois jours ou plus,
  à la fois dans votre propre projet (environ 4,31 $ US par jour) et dans un
  projet géré par RAD (101 crédits par jour).
- **Supprimez tout ce que Linkwarden utilise.** La majeure partie du coût
  d'exécution est généralement la base de données. Elle ne s'arrête que si rien
  d'autre dans le projet ne l'utilise, donc la suppression de Linkwarden alors
  que quelque chose d'autre partage le projet n'économise que la partie calcul
  de Linkwarden.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket
  à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
  dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Linkwarden
  pour une classe. Chaque participant obtient Linkwarden dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places à l'avance,
  soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session, et les crédits inutilisés reviennent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  Linkwarden pour un client à partir d'un portefeuille cloisonné qu'il finance,
  et règle directement avec le client. Si le portefeuille est faible, la
  facturation est suspendue et les données sont conservées, de sorte que personne
  ne reçoit de frais inattendus. À la fin de l'engagement, le partenaire remet
  le projet, et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN,
GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et l'estimation quotidienne de 101 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer
des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle. [Prix de Linkwarden Cloud](https://linkwarden.app/pricing).
Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Linkwarden s'exécute comme un seul pod Next.js. Le serveur web et un worker
d'archivage en arrière-plan s'exécutent côte à côte dans le MÊME conteneur
(via `concurrently`) — il n'y a pas de déploiement de worker séparé.
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Next.js + Chrome sans tête, 2 vCPU / 2 Gio par défaut, `min_instance_count = 1` |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le schéma Prisma de Linkwarden est uniquement Postgres |
| Stockage d'objets | Cloud Storage (volume GCS Fuse CSI) | Monté à `/data/data` par défaut pour les captures d'écran/PDF/monolithes archivés |
| Cache et file d'attente | Aucun | Le worker d'archivage interroge directement PostgreSQL ; pas de dépendance Redis/BullMQ |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré, `reserve_static_ip = true` |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le schéma Prisma de Linkwarden code en dur
  le fournisseur `postgresql` ; la sélection de tout autre moteur
  interrompt la migration au premier démarrage.
- **`DATABASE_URL` se connecte via la boucle de rappel cloud-sql-proxy.**
  `enable_cloudsql_volume = true` est requis — il lance le sidecar proxy qui répond
  sur `127.0.0.1`, que le point d'entrée cloud utilise avec
  `sslmode=disable` (le proxy termine déjà le TLS). Cela diffère de la
  variante Cloud Run, qui se connecte via l'IP privée brute avec
  `sslmode=require`.
- **`NEXTAUTH_URL` est dérivé automatiquement**, en ajoutant le suffixe
  `/api/v1/auth` requis à l'URL du service calculée.
- **`reserve_static_ip = true` par défaut.** Le `NEXTAUTH_URL` de Linkwarden
  intègre l'URL du service au démarrage du conteneur, de sorte qu'une IP
  externe stable évite la course de repli DNS interne documentée pour d'autres
  applications avec URL auto-référencées dans ce catalogue.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la mise
  à l'échelle à zéro) afin que le worker d'archivage en arrière-plan intégré
  au conteneur continue de traiter la file d'attente.
- **Chrome sans tête s'exécute en processus avec le serveur web.** Dimensionnez
  `container_resources` pour le pic de l'ensemble du conteneur (2 vCPU / 2 Gio par
  défaut ; augmentez la mémoire à 4 Gio pour les charges d'archivage lourdes).
- **Un volume GCS est monté automatiquement à `/data/data`.** C'est le chemin
  absolu vers lequel le code de stockage de Linkwarden résout `STORAGE_FOLDER`.
  L'ensemble du conteneur de l'image s'exécute en tant que root, donc aucune
  substitution d'option de montage gcsfuse uid/gid n'est nécessaire (contrairement
  à certains autres modules GKE de ce catalogue).
- **Pas de superutilisateur pré-initialisé.** Le premier utilisateur à
  s'inscrire via le flux d'inscription NextAuth standard devient le propriétaire
  de l'instance.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.
L'espace de noms et les autres identifiants sont indiqués dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Linkwarden {#a-gke-autopilot--the-linkwarden-workload}

Les pods Linkwarden sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Linkwarden pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour le fonctionnement d'Autopilot, de la mise à
l'échelle et du cycle de vie de la charge de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Linkwarden stocke toutes les données d'application (signets, collections, tags,
utilisateurs, métadonnées d'archive) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Le sidecar cloud-sql-proxy (activé via `enable_cloudsql_volume = true`)
écoute sur `127.0.0.1` ; le point d'entrée cloud connecte
`DATABASE_URL` là avec `sslmode=disable`. Lors du premier déploiement,
un Job d'initialisation crée la base de données et l'utilisateur de
l'application ; Linkwarden exécute ensuite son propre
`prisma migrate deploy` à chaque démarrage de conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage (contenu archivé) {#c-cloud-storage-archived-content}

Un bucket **Cloud Storage** dédié est provisionné automatiquement et monté via
le pilote CSI GCS Fuse à `/data/data` par défaut — le chemin absolu
vers lequel le code de stockage de Linkwarden résout `STORAGE_FOLDER` au
moment de l'exécution.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options du pilote CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :
`NEXTAUTH_SECRET` (signe les JWT de session NextAuth). Il est matérialisé
dans l'espace de noms et injecté comme variable d'environnement de pod. Le mot
de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est exposé via un service Kubernetes `LoadBalancer` avec une
adresse IP statique réservée par défaut (`reserve_static_ip = true`). Un Ingress
avec un domaine personnalisé et un certificat géré, Cloud CDN et Cloud Armor
peuvent être ajoutés.

- **Console :** Kubernetes Engine → Services et Ingress ; Services réseau →
  Équilibrage de charge.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Linkwarden {#3-linkwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`.
  Il se connecte via le sidecar cloud-sql-proxy et crée de manière
  idempotente la base de données et l'utilisateur de l'application et accorde
  les privilèges. Le job peut être réexécuté en toute sécurité.
- **Les migrations de schéma s'exécutent à chaque démarrage.** L'image de base
  de Linkwarden `CMD` exécute `prisma migrate deploy` avant de
  démarrer les processus web et worker, de sorte que la mise à niveau de la
  version de l'application applique automatiquement les modifications de schéma.
- **`NEXTAUTH_SECRET` est immuable après le premier démarrage.** Généré une
  fois et écrit dans Secret Manager. Sa rotation invalide toutes les sessions
  actives.
- **Pas de compte administrateur pré-initialisé.** Le premier utilisateur à
  s'inscrire via le flux d'inscription NextAuth standard devient le propriétaire
  de l'instance.
- **Worker d'archivage en arrière-plan.** Un processus séparé
  (`worker.ts`, exécuté via `concurrently` aux côtés du serveur
  web dans le même conteneur) interroge directement PostgreSQL et traite les
  liens en file d'attente par lots (`ARCHIVE_TAKE_COUNT`, par défaut
  `5`). Chaque lot lance des instances Chrome sans tête pour
  la capture de captures d'écran/PDF/monolithes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité par défaut sont
  `/` — Linkwarden n'a pas de point de terminaison de santé
  dédié confirmé. La sonde de démarrage permet une fenêtre généreuse pour le
  démarrage à froid de Next.js plus l'initialisation de Chrome/Playwright sans
  tête.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Linkwarden sont listés ; toute autre entrée est héritée de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 1 / 2 — Projet et identité {#group-1--2--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour les ressources régionales. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `linkwarden` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Linkwarden` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Linkwarden publie une véritable balise `latest` en amont. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="2Gi" }` | L'archivage Chrome sans tête s'exécute en processus ; augmentez la mémoire à `4Gi` pour les charges de travail lourdes. |
| `min_instance_count` | `1` | GKE n'a pas de mise à l'échelle à zéro ; maintient le worker d'archivage en vie. |
| `max_instance_count` | `5` | Limite supérieure HPA. |
| `container_port` | `3000` | Linkwarden (Next.js) écoute sur le port 3000. |
| `enable_cloudsql_volume` | `true` | Requis — lance le sidecar cloud-sql-proxy auquel le point d'entrée se connecte. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Linkwarden dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement statiques. `DATABASE_URL`, `NEXTAUTH_URL` sont définies automatiquement — ne les définissez pas ici. |
| `disable_browser` | `false` | Définit `DISABLE_BROWSER` — ignore toutes les tâches d'archivage Chrome sans tête. |
| `archive_take_count` | `5` | Liens traités par lot de worker en arrière-plan (`ARCHIVE_TAKE_COUNT`). |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'interface web publique nécessite une exposition externe. |
| `session_affinity` | `ClientIP` | Routage persistant pour les cookies de session NextAuth. |
| `namespace_name` | `""` | Laisser vide pour générer automatiquement. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — Linkwarden utilise un volume GCS à la place pour plus de simplicité. |
| `nfs_mount_path` | `/data/data` | Utilisé uniquement lorsque `enable_nfs = true`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` (revient à une valeur par défaut intégrée) | Un volume "storage" par défaut monté à `/data/data` est automatiquement câblé, sauf si vous fournissez votre propre liste, qui le remplace entièrement. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — le schéma Prisma de Linkwarden est uniquement Postgres. |
| `application_database_name` | `linkwarden` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `linkwarden` | Utilisateur de la base de données de l'application. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Le `NEXTAUTH_URL` de Linkwarden intègre l'URL du service au démarrage — une IP stable évite une course de repli DNS interne. |
| `enable_custom_domain` | `true` | Provisionner Ingress + certificat géré pour les noms d'hôtes personnalisés. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Linkwarden — son worker d'archivage interroge directement PostgreSQL. Conservé pour la parité des variables de la Fondation. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `service_external_ip` | IP interne au cluster / externe. |
| `service_url` | URL pour atteindre Linkwarden. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification. La plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Sa rotation invalide toutes les sessions actives, obligeant tous les utilisateurs à se reconnecter. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` (fixe) | Critique | Tout autre moteur interrompt complètement la migration Prisma au premier démarrage. |
| `enable_cloudsql_volume` | `true` (requis) | Critique | Le désactiver supprime le sidecar cloud-sql-proxy dont dépend le point d'entrée — `DATABASE_URL` ne se connecte à rien. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à 0 (non prise en charge par défaut sur GKE) arrêterait le worker d'archivage en arrière-plan. |
| `container_resources.memory_limit` | `2Gi` minimum | Élevé | L'archivage Chrome sans tête subit des OOM en dessous de ce seuil ; le serveur web peut toujours répondre tandis que l'archivage échoue silencieusement. |
| `service_type` | `LoadBalancer` | Élevé | Définir `ClusterIP` sur une interface utilisateur de signets publique la rend inaccessible depuis un navigateur (un modèle de bug de copier-coller connu ailleurs dans ce catalogue). |
| `reserve_static_ip` | `true` | Moyen | `false` risque que le `NEXTAUTH_URL` intégré de Linkwarden se résolve en un DNS interne inaccessible si l'IP éphémère n'est pas connue au moment de l'application. |
| `disable_browser` | `false` sauf si Chrome se comporte mal | Moyen | Le laisser `true` désactive inutilement tout l'archivage de captures d'écran/PDF/monolithes. |
| `gcs_volumes` | Utiliser la valeur par défaut intégrée | Moyen | Fournir une liste personnalisée sans faire correspondre le chemin de montage `/data/data` rend le contenu archivé non inscriptible ou divisé entre les backends de stockage. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Linkwarden partagée avec la variante
Cloud Run est décrite dans **[Linkwarden_Common](Linkwarden_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Linkwarden sur GKE Autopilot](../labs/Linkwarden_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Linkwarden Common — Configuration d'application partagée](Linkwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
