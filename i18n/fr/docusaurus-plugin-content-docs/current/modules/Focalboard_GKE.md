---
title: "Focalboard sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Focalboard sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Focalboard_GKE.md @ e69407af sha256:9cc016c1ad31 -->

# Focalboard sur GKE Autopilot {#focalboard-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Focalboard_GKE.png" alt="Focalboard sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Focalboard est un outil open source et auto-hébergé de gestion de projet et de
tableau Kanban de Mattermost — une alternative à Trello/Asana/Notion-boards avec
plusieurs vues de tableau (kanban, tableau, galerie, calendrier) pour organiser
les tâches avec des tableaux et des cartes. Ce module déploie Focalboard sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Focalboard utilise et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Coût de Focalboard sur RAD et comparaison {#what-focalboard-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, Focalboard sur le module GKE Autopilot de RAD coûte environ 150 $ US par mois, plus 17,50 $ US une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](Focalboard_CloudRun.md) exécute le même Focalboard pour environ 102 $ US par mois. Focalboard est un outil open source et auto-hébergé de tableau Kanban et de gestion de projet (une alternative à Trello/Asana/Notion) de Mattermost. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 150 $ US. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 par mois (environ 333 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 Gio, fonctionnant en permanence | 79 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache : une petite VM | 13 $ US |
| Passerelle Cloud NAT et adresse IP | 5 $ US |
| Cloud Storage pour les sauvegardes | 1 $ US |
| **Total** | **environ 150 $ US** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 $ US par mois.

### Comparaison {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Focalboard au 8 octobre 2026, donc la comparaison honnête se fait par rapport à l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, GKE Autopilot, votre propre projet** | **150 $ US**, plus 17,50 $ US une fois | L'automatisation de RAD, dans votre projet |
| RAD, Cloud Run | environ 102 $ US ; voir le [guide Cloud Run](Focalboard_CloudRun.md) | RAD |

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence réside dans ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Focalboard est un outil open source et auto-hébergé de tableau Kanban et de gestion de projet (une alternative à Trello/Asana/Notion) de Mattermost.** Cela détermine quelle colonne est importante : une opération prévisible et sans intervention est plus précieuse pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Focalboard s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la réduction d'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 150 $ US.** Déployez Focalboard, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles il a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en fonctionnement, de sorte que Focalboard ne se met jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US). La suppression permet d'économiser de l'argent si Focalboard resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 5 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (111 crédits par jour).
- **Supprimez tout ce que Focalboard utilise.** La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez les données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez les paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient Focalboard dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Focalboard fonctionne comme une seule charge de travail web Go/React. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Par défaut un **StatefulSet** (voir ci-dessous), serveur Focalboard sur le port `8000`, 2 vCPU / 4 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — moteur verrouillé sur PostgreSQL 13/14/15 (ou `NONE`) ; MySQL est rejeté au moment de la planification |
| Stockage par blocs | Persistent Disk (PVC par pod) | `10Gi` `standard-rwo` (SSD) PVC monté à `/data`, supportant le stockage des pièces jointes de Focalboard (`FOCALBOARD_FILESPATH`) |
| Persistance des fichiers | Cloud Filestore (NFS) | Provisionné par défaut (`enable_nfs = true`) à `/opt/focalboard/storage`, mais pas le chemin où Focalboard écrit réellement les pièces jointes — voir les pièges |
| Stockage d'objets | Cloud Storage | Un bucket suffixé par `storage` est toujours provisionné ; monté via gcsfuse uniquement dans le répertoire de données lorsque le PVC par blocs est désactivé |
| Secrets | Secret Manager | `FOCALBOARD_ADMIN_PASSWORD` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; routage de domaine personnalisé activé par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL uniquement.** `database_type` par défaut à `POSTGRES_15` ; une
  précondition au moment de la planification dans `validation.tf` rejette tout
  sauf `POSTGRES_13`, `POSTGRES_14`, `POSTGRES_15`, ou `NONE`
  — MySQL n'est pas pris en charge.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur loopback.** Sur GKE,
  `DB_HOST` se résout en `127.0.0.1` (le sidecar
  cloud-sql-proxy), et le point d'entrée construit un DSN libpq en texte clair
  (`sslmode=disable`) pour ce cas.
- **La charge de travail est par défaut un StatefulSet, pas un Deployment.**
  `stateful_pvc_enabled
  = true` par défaut, qui résout automatiquement `workload_type` en
  `StatefulSet` (selon la convention à l'échelle du dépôt — voir
  [App_GKE](App_GKE.md) Groupe 7). Chaque réplica de pod obtient son **propre**
  PVC `10Gi` `standard-rwo` **isolé** monté à `/data` — les
  pièces jointes ne sont **pas** partagées entre les réplicas.
- **`min_instance_count = 1`, `max_instance_count = 5` par défaut** — mais parce que le
  stockage est un PVC par pod (pas un système de fichiers partagé), la mise à
  l'échelle à plus d'un réplica divise les pièces jointes de tableau téléchargées
  entre des volumes isolés ; voir le tableau des pièges avant d'augmenter
  `max_instance_count`.
- **NFS est provisionné par défaut mais non utilisé par le propre chemin de
  stockage de Focalboard.** `enable_nfs = true` monte Filestore à `nfs_mount_path`
  (`/opt/focalboard/storage`), un chemin différent du chemin `FOCALBOARD_FILESPATH`
  (`/data`) supporté par le PVC par blocs que le point d'entrée configure
  réellement.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **Pas de job de migration séparé.** Focalboard exécute ses propres migrations de
  schéma au démarrage en tant qu'utilisateur de la base de données de
  l'application (voir `Focalboard_Common/main.tf`) ; le job `db-init` ne fait que créer la
  base de données, le rôle et les autorisations.
- **`FOCALBOARD_ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret Manager,
  injecté comme variable d'environnement secrète de conteneur — voir la mise en
  garde dans la [Section 3](#3-focalboard-application-behaviour) concernant la
  consommation par le serveur Focalboard lui-même.
- **L'URL du service est remplie automatiquement.** Le `serverRoot` du point
  d'entrée revient à `FOCALBOARD_SERVER_ROOT` → `CLOUDRUN_SERVICE_URL` → `GKE_SERVICE_URL` →
  `http://localhost:8000` ; App_GKE injecte `GKE_SERVICE_URL` pour chaque charge de travail
  GKE, donc aucune étape manuelle d'URL post-déploiement n'est requise.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Focalboard {#a-gke-autopilot--the-focalboard-workload}

Par défaut, Focalboard s'exécute en tant que **StatefulSet** (car `stateful_pvc_enabled =
true` est la valeur par défaut du module), donnant au pod unique une identité stable et son propre PVC. Si vous désactivez le PVC par blocs, la charge de travail se résout en un `Deployment` à la place.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Focalboard pour les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app=focalboard --tail=100
  ```

Voir [App_GKE](App_GKE.md) Groupe 6 (Configuration du backend) et Groupe 7 (StatefulSet/PVC) pour la résolution du type de charge de travail et de la mise à l'échelle Autopilot.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Focalboard stocke toutes les données de l'application (tableaux, cartes, blocs,
utilisateurs) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods y
accèdent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune IP
publique n'est exposée. Lors du premier déploiement, le job `db-init`
(`postgres:15-alpine`) crée de manière idempotente la base de données de
l'application, le rôle et les autorisations — le binaire de Focalboard exécute
ensuite les migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe se trouvent tous dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe.

### C. Stockage par blocs (PVC) et Cloud Storage {#c-block-storage-pvc--cloud-storage}

Les pièces jointes de tableau téléchargées persistent sous `FOCALBOARD_FILESPATH` (par défaut `/data`),
soutenues par un PVC `10Gi` `standard-rwo` (Persistent Disk équilibré de classe SSD) créé
par pod par le StatefulSet. Un bucket Cloud Storage séparé est toujours provisionné
mais n'est monté via gcsfuse dans le répertoire de données que lorsque le PVC par blocs est désactivé (évitant un
double montage, car gcsfuse peut corrompre les fichiers d'index/média de Focalboard).

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud storage buckets list --project "$PROJECT" --filter="name~focalboard"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) Groupe 7 (StatefulSet/PVC), Groupe 13 (NFS) et Groupe 14
(Cloud Storage/GCS Fuse) pour les mécanismes généraux et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret spécifique à Focalboard est généré automatiquement et stocké dans Secret
Manager : `FOCALBOARD_ADMIN_PASSWORD` (un mot de passe aléatoire de 24 caractères). Le mot de passe de la base de données
est géré séparément par la fondation. Sur GKE, les secrets sont projetés
dans les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~focalboard"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive aux
redéploiements) avec un Ingress Kubernetes pour le routage de domaine personnalisé activé
(`enable_custom_domain = true`).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles (`uptime_check_config.enabled` par défaut à `false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Focalboard {#3-focalboard-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il attend que Cloud SQL accepte les connexions, crée de manière idempotente
  le rôle d'application (privilège `CREATEDB`) et la base de données, accorde tous
  les privilèges sur la base de données, accorde/réaffecte le schéma `public` à l'utilisateur de l'application
  (la réaffectation du propriétaire du schéma n'est pas fatale si elle échoue), puis signale au
  sidecar Cloud SQL Auth Proxy de s'arrêter (`quitquitquit`) afin que le pod du Job
  se termine. Le job peut être réexécuté en toute sécurité (`execute_on_apply = true`).
- **Pas de job de migration séparé — Focalboard se migre lui-même au démarrage.** Le
  commentaire du module `Focalboard_Common` l'indique explicitement : « Focalboard exécute
  ses propres migrations de schéma au démarrage ; aucune extension Postgres n'est requise. » L'utilisateur
  de l'application a besoin de la pleine propriété du schéma `public` pour que cela fonctionne,
  ce que `db-init.sh` accorde.
- **Compte administrateur — À FAIRE : pas entièrement confirmé par la source.** Un secret `FOCALBOARD_ADMIN_
  PASSWORD` est généré et injecté comme variable d'environnement secrète de conteneur, mais le
  script `entrypoint.sh` ne le référence **pas** lors de l'écriture de `config.json`
  (`authMode` est défini sur `"native"`). Il n'a pas pu être confirmé à partir de la source de ce module
  si le binaire Focalboard en amont consomme lui-même
  `FOCALBOARD_ADMIN_PASSWORD` pour amorcer un compte administrateur, ou si (comme c'est
  courant pour l'authentification native de Focalboard) le premier utilisateur à s'inscrire via l'interface utilisateur
  devient simplement l'administrateur de l'espace de travail. Récupérez le secret et essayez-le lors de la
  première connexion ; s'il ne s'applique pas, enregistrez le premier compte via l'interface utilisateur.
- **Câblage des variables d'environnement de la base de données.** `entrypoint.sh` construit un seul DSN de mot-clé libpq
  (`dbconfig` dans `config.json`) à partir des variables `DB_HOST`/`DB_IP`/
  `DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` injectées par la Fondation, en se basant sur l'hôte *résolu* :
  un répertoire de socket Unix Cloud Run préfère `DB_IP` avec `sslmode=require` ; un
  hôte loopback (le sidecar proxy GKE, `127.0.0.1`) utilise `sslmode=disable` ; toute
  autre IP réelle utilise `sslmode=require`. Sur GKE, cela se résout toujours au cas loopback,
  texte clair vers le sidecar.
- **Le `DB_PASSWORD` que ce DSN contient est un secret dédié alphanumérique uniquement, pas
  `database_password_secret`.** Le mot de passe de base de données standard de la Fondation à l'échelle de la flotte
  (jeu de caractères `_%@`) peut contenir un `%` qui fait planter le pilote Postgres Go de Focalboard —
  sa passerelle de validation DSN basée sur `url.Parse` et son connecteur `lib/pq` réel
  ne sont pas d'accord sur le décodage en pourcentage, donc aucun encodage unique de ce mot de passe ne satisfait
  les deux. `Focalboard_Common` génère un mot de passe séparé
  (`secret-<resource_prefix>-focalboard-safe-db-password`), remplace le
  `DB_PASSWORD` du SERVICE par celui-ci, et le passe à `db-init` comme
  `FOCALBOARD_SAFE_DB_PASSWORD`, ce qui est le mot de passe du rôle Postgres
  réellement défini. C'est identique au comportement de Cloud Run puisque `db-init.sh`
  est partagé via `Focalboard_Common`. La sortie `database_password_secret` (§5)
  rapporte le nom du secret à l'échelle de la flotte, qui ne s'authentifie pas contre ce
  rôle.
- **Chemin de stockage des pièces jointes.** `FOCALBOARD_FILESPATH` est défini sur `data_dir`, ce qui
  la variante GKE relie à `stateful_pvc_mount_path` (par défaut `/data`) — le même
  chemin sur lequel le PVC par blocs par pod est monté. Le Dockerfile pré-crée `/data` avec
  `chmod 0777` afin qu'un nouveau montage PVC soit inscriptible au démarrage, quel que soit le pod
  exécuté en tant qu'UID non root.
- **Sondes de santé.** Sonde de démarrage : **HTTP** `GET /`, `initial_delay_seconds=60`,
  `timeout_seconds=10`, `period_seconds=15`, `failure_threshold=30` (jusqu'à ~8,5
  minutes de grâce au démarrage). Sonde de vivacité : **HTTP** `GET /`,
  `initial_delay_seconds=60`, `timeout_seconds=5`, `period_seconds=30`,
  `failure_threshold=3`. Une sonde de disponibilité (**HTTP** `GET /`, `initial_delay=30s`,
  `period=10s`, `failure_threshold=3`) est également codée en dur dans `Focalboard_Common` et
  n'est pas exposée comme variable.
- **L'URL du service se résout automatiquement.** `serverRoot` dans `config.json` revient
  à `GKE_SERVICE_URL`, que App_GKE injecte pour chaque charge de travail GKE — contrairement à certains
  autres modules, aucun patch manuel `environment_variables` n'est requis après le déploiement
  sauf si vous souhaitez une URL de domaine personnalisé spécifique à la place.
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- cat /opt/focalboard/config.json
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Focalboard sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `focalboard` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `7.11.4` | Tag d'image `mattermost/focalboard` utilisé comme base de build personnalisé. Incrémenter pour déclencher une reconstruction ; `latest` est épinglé à `7.11.4` au moment du build (pas un tag upstream publié). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `8000` | Port d'écoute natif de Focalboard. |
| `container_resources` | `2000m` CPU / `4Gi` mémoire | Limites par défaut ; aucune requête explicite définie. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback `127.0.0.1:5432`) — requis sur GKE. |
| `container_image_source` | `custom` | `FROM mattermost/focalboard` construit comme un wrapper léger ajoutant le point d'entrée cloud. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Focalboard. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Donne à chaque pod son propre PVC par blocs pour `/data` (pièces jointes), évitant la corruption des fichiers d'index/média par gcsfuse. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Doit correspondre à `filespath` de Focalboard ; également passé comme `data_dir` à `Focalboard_Common`, qui définit `FOCALBOARD_FILESPATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré basé sur SSD ; utilise le quota `SSD_TOTAL_GB` plus strict (voir [App_GKE](App_GKE.md) / conventions de dépôt sur le passage au HDD). |

### Groupe 10 — Observabilité {#group-10--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai 60s, 30 tentatives @ 15s | Régit la sonde de démarrage réelle du conteneur (câblée via `Focalboard_Common`, pas le générique `startup_probe_config`). |
| `liveness_probe` | HTTP `/`, délai 60s, 3 tentatives @ 30s | Régit la sonde de vivacité réelle du conteneur. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore, mais le propre chemin de pièce jointe de Focalboard (`FOCALBOARD_FILESPATH`) est le PVC par blocs à `stateful_pvc_mount_path`, pas le montage NFS — voir [Section 1](#1-overview). |
| `nfs_mount_path` | `/opt/focalboard/storage` | Où le volume NFS (actuellement inutilisé par Focalboard) est monté. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Verrouillé sur PostgreSQL 13/14/15 (ou `NONE`) par une précondition au moment de la planification — MySQL est rejeté. |
| `application_database_name` | `focalboard` | Nom de la base de données. Effectivement immuable après le premier déploiement (le renommage orpheline les données existantes). |
| `application_database_user` | `focalboard` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | L'Ingress pour le routage de domaine personnalisé est activé par défaut (diffère de nombreux autres modules, qui le désactivent par défaut). |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Focalboard. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de base de données standard à l'échelle de la flotte — **pas** l'identifiant avec lequel le rôle Postgres de Focalboard s'authentifie (voir [Section 3](#3-focalboard-application-behaviour)) ; utilisez `secret-<resource_prefix>-focalboard-safe-db-password` à la place. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Une précondition `validation.tf` rejette MySQL et les autres moteurs non-Postgres au moment de la planification. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Effectivement immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline tous les tableaux/cartes. |
| `max_instance_count` | `1` sauf si vous ré-architecturez le stockage | Critique | Avec le `stateful_pvc_enabled = true` par défaut, chaque réplica obtient son **propre** PVC **isolé** — les pièces jointes téléchargées sur un pod sont invisibles depuis un autre. La mise à l'échelle au-delà de 1 divise silencieusement les données, elle ne génère pas d'erreur. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité à la base de données sur GKE. |
| `stateful_pvc_enabled` | `true` | Élevé | Le désactiver (et se fier à gcsfuse à la place) risque de corrompre les fichiers d'index/média de Focalboard lors d'écritures concurrentes — c'est exactement pourquoi le module Common ignore le montage gcsfuse lorsque le PVC par blocs est activé. |
| `stateful_pvc_mount_path` | `/data` (doit être égal à `filespath` de Focalboard) | Élevé | Le modifier sans également mettre à jour le câblage `FOCALBOARD_FILESPATH` monte le PVC à un endroit où Focalboard n'écrit jamais, le rendant effectivement éphémère. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les requêtes rebondissent entre les pods, ce qui est plus important une fois que plusieurs réplicas existent. |
| `enable_nfs` | `true` (mais considérez `false`) | Moyen | Provisionne une instance Filestore que le propre chemin de pièce jointe de Focalboard n'utilise pas — un coût évitable à moins que quelque chose d'autre dans votre déploiement n'en ait besoin. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Moyen | Utilise le quota strict `SSD_TOTAL_GB` (Qwiklabs ≈ 500 Go) ; une campagne de modules avec état peut l'épuiser. Remplacer par `standard` (HDD `pd-standard`) si les IOPS ne sont pas nécessaires. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `FOCALBOARD_ADMIN_PASSWORD` (auto-généré) | Récupérer avant la première connexion | Moyen | Non confirmé pour amorcer une connexion par lui-même (voir [Section 3](#3-focalboard-application-behaviour)) — l'étape pratique de première exécution peut plutôt être l'enregistrement du premier utilisateur via l'interface utilisateur. |
| Sortie `database_password_secret` | Ne l'utilisez pas pour vous connecter | Élevé | Rapporte le secret `DB_PASSWORD` à l'échelle de la flotte, qui ne s'authentifie pas contre le rôle Postgres de Focalboard. Récupérez `secret-<resource_prefix>-focalboard-safe-db-password` pour un identifiant fonctionnel. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et toute URL mise en favori. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Focalboard partagée avec la variante Cloud Run est
décrite dans **[Focalboard_Common](Focalboard_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Focalboard sur GKE Autopilot](../labs/Focalboard_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Focalboard sur Google Cloud Run](Focalboard_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Focalboard Common — Configuration d'application partagée](Focalboard_Common.md) — la configuration partagée par les deux cibles de déploiement.
