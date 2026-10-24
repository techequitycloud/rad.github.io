---
title: "Maybe Finance sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Maybe Finance sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/MaybeFinance_GKE.md @ e69407af sha256:7067830a485d -->

# Maybe Finance sur GKE Autopilot {#maybe-finance-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MaybeFinance_GKE.png" alt="Maybe Finance sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Maybe (Maybe Finance) est une alternative open-source et auto-hébergée à
Mint/Monarch pour la gestion des finances personnelles et du patrimoine —
budgétisation, suivi de la valeur nette, catégorisation des transactions et
agrégation multi-comptes, construite sur Ruby on Rails. Ce module déploie
Maybe sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Maybe et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte MaybeFinance sur RAD, et comparaison {#what-maybefinance-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Maybe sur RAD coûte environ 150 $ US par mois
dans votre propre projet, sans abonnement mensuel par foyer.** RAD facture
300 crédits une fois par déploiement dans votre propre projet (270 crédits,
soit 10 % de moins, dans un projet géré par RAD), plus le temps de build. La
même application se déploie également sur Cloud Run pour environ 102 $ US par
mois — voir le [guide Cloud Run](MaybeFinance_CloudRun.md) pour l'option à
moindre coût. Si vous n'en avez besoin qu'occasionnellement, un projet géré
par RAD peut être supprimé et restauré dans les 30 jours pour quelques
crédits, de sorte que ce chiffre mensuel devient quelques dollars au lieu de
cela — voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30,00 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 par mois (environ 333,00 $ US au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est maintenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un
abonnement mensuel. Dans un projet géré par RAD, la base de données, le
serveur de fichiers et le réseau sont partagés par toutes les applications du
projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base
de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ US si c'est votre seul cluster, sinon ~73 $ US |
| **Total** | **environ 150 $ US** |

### Comparaison {#how-it-compares}

- **Monarch Money**, un traqueur de finances personnelles et de valeur nette
  hébergé, coûte **14,99 $ US par mois** (99,99 $ US par an, soit environ 8,33
  $ US par mois facturés annuellement).
- Le module Maybe de RAD coûte environ 150 $ US par mois dans votre propre
  projet — bien plus que Monarch Money en termes monétaires pour un seul
  foyer. L'argument en faveur de l'auto-hébergement ici n'est pas le prix,
  c'est que **vos comptes bancaires liés, vos soldes et vos transactions
  résident dans une infrastructure que vous contrôlez**, plutôt qu'avec un
  agrégateur tiers qui stocke vos identifiants bancaires et vend des données
  financières anonymisées dans le cadre de son modèle commercial.
- Comparaison auto-gérée : à 2 vCPU / 4 GiB avec une base de données
  Postgres, un GCP Compute Engine e2-standard-2 (~49 $/mois) est à portée,
  mais vous gérez Postgres, les sauvegardes, les correctifs de sécurité et la
  disponibilité vous-même pour des données aussi sensibles.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si MaybeFinance s'exécute dans **un projet géré par RAD pour vous**, vous
avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro :
**supprimer l'ensemble du projet et le restaurer dans les 30 jours pour
presque rien.** Cela convient bien à MaybeFinance si vous n'en avez besoin
qu'occasionnellement — pour l'évaluer, un environnement de démonstration, une
charge de travail saisonnière ou intermittente — bien mieux que de le faire
fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie
  d'abord sa facturation, puis demande à Google de supprimer le projet.
  Google ne supprime pas le projet immédiatement : il le conserve,
  récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien
  n'est facturé pendant cette période d'attente. Contrairement à la
  suppression d'un module, cela ne détruit pas la base de données, aucune VM
  ou la ressource de calcul une par une — l'ensemble du projet, et tout ce
  qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de restaurer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer
  que tout est revenu. Comme rien n'a été détruit individuellement, cette
  mise à jour trouve les mêmes ressources déjà présentes — c'est une
  vérification, pas une reconstruction, et une mise à jour ne facture jamais
  les frais de module à nouveau. Pour MaybeFinance derrière Services_GCP (un
  cluster GKE, une petite VM NFS/cache, une base de données Postgres) et
  Project_GCP, cela représente environ **une poignée de crédits (moins de 1
  $ US)** au total, contre environ 305 crédits (30,50 $ US) que coûte un
  redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 150 $ US.** Déployez MaybeFinance, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez
  besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque
  vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les
  builds, et le temps pendant lequel il a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un
  projet dont RAD ne gère que la facturation), et vous le restaurez vous-même
  dans les 30 jours — après cela, Google le supprime définitivement. La
  restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours atteindre le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations
  d'évaluation conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la
  suppression logicielle de Cloud Storage, il est donc très probable qu'il
  disparaisse dès que vous supprimez le projet — même si le projet lui-même
  est récupérable pendant 30 jours. Si vous avez personnalisé MaybeFinance et
  que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter
de payer est de supprimer le déploiement et de le redéployer lorsque vous en
avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 305 crédits (30,50 $ US) au total. La suppression permet
  d'économiser de l'argent seulement si MaybeFinance resterait inutilisé
  assez longtemps pour compenser ce coût de redéploiement par rapport à son
  propre coût d'exécution — environ **7 jours ou plus**, à la fois dans votre
  propre projet (environ 4,99 $ US par jour) et dans un projet géré par RAD
  (111 crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  MaybeFinance, il s'agit de la base de données et de la VM de fichier/cache
  partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les
  utilise, donc la suppression de cette application alors que quelque chose
  d'autre partage le projet n'économise que la partie calcul propre à cette
  application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de la supprimer si vous voulez la
  conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant reçoit l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est interrompue et les données sont
  conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété
  du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets
Cloud Storage sans suppression logicielle ; [Monarch
Money](https://www.monarch.com/pricing). Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Maybe s'exécute comme une seule charge de travail web Rails/Puma avec un
processus de tâche d'arrière-plan Sidekiq co-localisé dans le même
conteneur. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut ; Sidekiq s'exécute comme un processus d'arrière-plan dans le même conteneur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — un garde au moment du plan n'accepte que `POSTGRES_13`/`14`/`15` (ou `NONE`) ; MySQL est rejeté |
| Tâches d'arrière-plan et interface utilisateur en temps réel | Redis (via la VM NFS partagée, ou un hôte explicite) | Obligatoire — un garde au moment du plan échoue si désactivé ; alimente Sidekiq (synchronisation de compte, traitement d'importation, notifications) et ActionCable |
| Persistance de fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/rails/storage`, partagées entre les pods ; également la source par défaut pour l'adresse IP de l'hôte Redis |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est auto-provisionné par `MaybeFinance_Common` ; non monté dans les pods sauf si `gcs_volumes` est défini |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré (clé de session/chiffrement Rails) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe avec une IP statique réservée ; domaine personnalisé + certificat géré activés par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` est par défaut `POSTGRES_15`
  et un garde au moment du plan (`validation.tf`) rejette tout autre
  que `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas
  pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment du plan
  échoue carrément si `enable_redis = false`. Lorsque `redis_host` est laissé vide,
  `enable_nfs` doit rester `true` afin que l'adresse IP du serveur NFS
  partagé soit utilisée comme hôte Redis (la VM NFS co-héberge Redis dans la
  convention de ce dépôt).
- **Cloud SQL est accessible via le sidecar Auth Proxy sur loopback.**
  `enable_cloudsql_volume = true` injecte un sidecar cloud-sql-proxy écoutant
  sur `127.0.0.1:5432`. Rails ne peut pas analyser le DSN de socket Unix de Cloud SQL,
  donc le point d'entrée cloud ne construit jamais un DSN de style URL — il
  mappe les variables d'environnement `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`
  de la fondation sur les variables d'environnement discrètes
  `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` de Maybe et définit
  `PGSSLMODE=disable` sur loopback (`require` sur une vraie IP privée).
- **`min_instance_count = 1` / `max_instance_count = 5`.** Au moins un pod reste actif
  afin que le worker Sidekiq intégré continue de vider la file d'attente des
  tâches ; la mise à l'échelle à zéro arrête complètement les tâches
  d'arrière-plan.
- **Conteneur web + worker combiné, pas un sidecar.** Le point d'entrée cloud
  démarre `bundle exec sidekiq` en arrière-plan, puis `exec` le serveur web
  Rails au premier plan du *même* conteneur — Maybe n'est pas déployé avec un
  worker `additional_services` séparé.
- **`SECRET_KEY_BASE` est généré une seule fois** par `MaybeFinance_Common` et stocké
  dans Secret Manager, partagé de manière identique par les processus web et
  Sidekiq. Rails l'utilise pour signer les sessions/cookies et pour dériver
  la clé qui chiffre les colonnes chiffrées d'ActiveRecord.
- **Le schéma est créé par un job d'initialisation, pas au démarrage.** Le
  job `maybefinance-migrate` exécute `rails db:prepare` pendant l'apply ; le point
  d'entrée d'exécution n'exécute jamais de migrations.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **`container_image_source = "custom"`.** Cloud Build construit une image wrapper légère
  `FROM ghcr.io/maybe-finance/maybe:<version>`. `application_version` est par défaut
  `"stable"` ; une requête `"latest"` est mappée au canal
  épinglé `stable` via l'ARG de build spécifique à l'application
  `MAYBE_VERSION` (l'ARG de build générique `APP_VERSION` de la fondation n'est
  intentionnellement pas utilisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Maybe (web + Sidekiq) {#a-gke-autopilot--the-maybe-workload-web--sidekiq}

Les pods Maybe sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Le serveur web Rails/Puma et le worker
Sidekiq s'exécutent comme deux processus dans le même conteneur, partageant
`SECRET_KEY_BASE` et la connexion Redis.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la
  charge de travail Maybe pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ps aux | grep -E 'puma|sidekiq'
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Maybe stocke toutes les données d'application (comptes, transactions, budgets,
utilisateurs) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les
pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ;
aucune IP publique n'est exposée. Lors du premier déploiement, le job
`db-init` crée la base de données et l'utilisateur de l'application,
accorde le rôle d'application `cloudsqlsuperuser` (afin que les migrations de Maybe
puissent créer des extensions Postgres sans accès superutilisateur), et
pré-crée l'extension `pgcrypto` ; `maybefinance-migrate` exécute ensuite
`rails db:prepare`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. NFS (Cloud Filestore) et Redis {#c-nfs-cloud-filestore--redis}

**Cloud Filestore (NFS)** est monté à `/rails/storage` afin que les pièces
jointes téléchargées persistent et soient partagées entre les pods. Maybe
nécessite également **Redis** pour Sidekiq (synchronisation de compte en
arrière-plan, traitement d'importation, notifications) et ActionCable (mises
à jour de l'interface utilisateur en temps réel) ; lorsque `redis_host` est
laissé vide, `REDIS_HOST` injecté se résout à l'adresse IP du serveur NFS
partagé (la VM NFS co-héberge Redis dans la convention de plateforme de ce
dépôt).

> **Sidekiq nécessite Redis 6.2 ou plus récent, et le Redis hébergé sur NFS
> est 6.0.** Le Redis partagé sur la VM NFS exécute 6.0.16, et Sidekiq 7
> refuse de démarrer avec lui. L'interface utilisateur web continue de
> fonctionner (le point d'entrée met Sidekiq en arrière-plan), de sorte que
> le déploiement semble sain alors qu'aucune tâche d'arrière-plan ne
> s'exécute. Pointez `redis_host` vers une instance Redis 6.2+ — par exemple
> Memorystore, via `create_redis = true` dans Services_GCP, qui provisionne Redis 7.2.

- **Console :** Filestore → Instances ; Compute Engine → Instances de VM (la
  VM NFS, si elle exécute également Redis).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'REDIS_URL|REDIS_HOST'
  ```

Voir [App_GKE](App_GKE.md) pour le comportement de découverte/provisionnement
NFS et les mécanismes d'injection Redis.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** (suffixe `storage`) est provisionné
automatiquement par `MaybeFinance_Common`, et la variable par défaut
`storage_buckets` ajoute un second bucket (suffixe `data`). Aucun des
deux n'est monté dans le système de fichiers du pod par défaut —
`gcs_volumes` est vide par défaut — ils existent donc en tant que stockage
provisionné mais sont inertes jusqu'à ce qu'ils soient explicitement
connectés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Maybe est généré automatiquement et stocké dans
Secret Manager : `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`),
une valeur aléatoire de 64 caractères partagée par le processus web Rails et
le worker Sidekiq. Le mot de passe de la base de données est géré
séparément par la fondation. Sur GKE, les secrets sont projetés dans les pods
via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### F. Réseau et Ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements) avec `enable_custom_domain = true` provisionnant un Ingress
Kubernetes. `network_tags` est par défaut `["nfsserver"]`, requis pour le
chemin de découverte NFS/Redis.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging (`RAILS_LOG_TO_STDOUT = "true"`) ; les
métriques GKE et Cloud SQL vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Maybe Finance {#3-maybe-finance-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte à Cloud SQL, crée de manière idempotente la
  base de données et l'utilisateur de l'application, accorde les privilèges,
  accorde le rôle d'application `cloudsqlsuperuser` (les utilisateurs d'application
  de Cloud SQL ne sont pas de vrais superutilisateurs, cela permet donc aux
  propres migrations de Maybe de créer des extensions Postgres), et pré-crée
  `pgcrypto` comme mesure de précaution. Le job peut être réexécuté en
  toute sécurité (`execute_on_apply = true`, `max_retries = 1`).
- **La migration du schéma est un job d'initialisation distinct.**
  `maybefinance-migrate` exécute `bundle exec rails db:prepare` sur l'image construite pour
  l'application (`image = null` dans sa spécification de job, de sorte qu'il
  réutilise l'image Maybe et la chaîne d'outils construites), dépend de
  l'achèvement de `db-init` en premier, et réessaie jusqu'à 3 fois
  (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **Enregistrement de l'administrateur à la première exécution, pas un secret
  auto-créé.** `SELF_HOSTED = "true"` active l'interface utilisateur d'auto-hébergement
  de Maybe, qui permet au premier visiteur d'enregistrer le compte
  administrateur initial via l'interface utilisateur web — contrairement à
  certains autres modules de ce dépôt, il n'y a pas de secret de mot de passe
  administrateur auto-généré à récupérer. {/* TODO: verify whether a first-run invite/registration lock exists after the first admin is created */}
- **`SECRET_KEY_BASE` est immuable en pratique.** Il est généré une seule fois
  par `MaybeFinance_Common` et partagé par les processus web et Sidekiq. Le
  faire pivoter après le premier démarrage invalide les sessions existantes
  et rend les colonnes chiffrées d'ActiveRecord illisibles.
- **Le mappage des variables d'environnement de la base de données se fait
  dans le point d'entrée cloud, pas un DSN d'URL.** La plateforme injecte
  `DB_HOST` (loopback via le sidecar proxy sur GKE),
  `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; le point d'entrée
  mappe ceux-ci sur `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (la convention
  Rails `config/database.yml` de Maybe) et définit `PGSSLMODE` selon que l'hôte
  résolu est loopback.
- **Câblage Redis.** `REDIS_URL` est construit à partir de
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` injectés si non déjà défini. Si
  `REDIS_URL` se retrouve vide (Redis inaccessible), le point d'entrée
  saute entièrement le démarrage de Sidekiq — les tâches d'arrière-plan
  s'arrêtent silencieusement au lieu de faire planter le pod.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /up` avec
  une allocation généreuse pour un premier démarrage lent (`initial_delay_seconds = 60`,
  `period_seconds = 15`, `failure_threshold = 30` — environ 8 minutes de
  marge). La sonde de vivacité est également **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`, `failure_threshold = 3`).
- **Inspecter les jobs d'initialisation et la configuration en cours
  d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<maybefinance-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'RAILS_ENV|POSTGRES_|REDIS_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (la balise `{{UIMeta group=N}}` dans la description de
chaque variable dans `variables.tf`). Seuls les paramètres spécifiques ou
notables pour Maybe sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `maybefinance` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image `ghcr.io/maybe-finance/maybe` utilisé comme base de build personnalisé ; `latest` est mappé au canal de publication épinglé `stable` via `MAYBE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port natif Rails/Puma de Maybe. |
| `container_resources` | `cpu_limit=2000m, memory_limit=4Gi` | 2 vCPU / 4 GiB pour le conteneur combiné Rails + Sidekiq. |
| `min_instance_count` | `1` | Maintenir à 1 afin que le worker Sidekiq co-localisé ait toujours un pod pour s'exécuter. |
| `max_instance_count` | `5` | Plafond HPA. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |
| `container_image_source` | `custom` | Image wrapper légère construite À PARTIR de l'image GHCR amont. |

### Groupe 6 — Backend GKE et Cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur Maybe. |
| `workload_type` | `null` → `Deployment` | Déploiement (pod web + Sidekiq combiné). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Maintient au moins un pod disponible pendant les perturbations volontaires des nœuds. |
| `pdb_min_available` | `"1"` | Nombre minimum de pods disponibles pendant les perturbations. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Les pièces jointes persistent et sont partagées entre les pods ; également la source par défaut pour l'adresse IP de l'hôte Redis. |
| `nfs_mount_path` | `/rails/storage` | Où Maybe stocke les pièces jointes téléchargées. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — un garde au moment du plan échoue si défini sur `false`. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port du serveur Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Le garde restreint cela à `POSTGRES_13`/`14`/`15`/`NONE` ; MySQL est rejeté. |
| `application_database_name` | `maybefinance` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `maybefinance` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour le routage de domaine personnalisé. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tag requis pour la découverte NFS/Redis-host. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Maybe. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `maybefinance-migrate`) et d'importation (facultatif). |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment du plan — plus les propres
> gardes `validation.tf` de MaybeFinance (Redis obligatoire, PostgreSQL
> uniquement, `min` ≤ `max`, identifiants IAP requis
> lorsqu'activé, pas d'Auth Proxy sans une vraie base de données). Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Un moteur non-PostgreSQL est rejeté au moment du plan ; forcer un contournement du garde rompt l'installateur et chaque requête. |
| `enable_redis` | `true` | Critique | Le garde au moment du plan bloque `false` purement et simplement — Maybe n'a pas de file d'attente de tâches d'arrière-plan fonctionnelle ni d'interface utilisateur en temps réel sans Redis. |
| `application_database_name` / `application_database_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais changer | Critique | Le faire pivoter après le premier démarrage invalide toutes les sessions et rend les colonnes chiffrées d'ActiveRecord illisibles. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à 0 arrête le worker Sidekiq co-localisé — la synchronisation de compte, le traitement d'importation et les notifications cessent silencieusement de se déclencher. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité de la base de données sur GKE. |
| `enable_nfs` | `true` (sauf si `redis_host` est explicitement défini) | Élevé | S'il est laissé `false` avec `redis_host` vide, le garde au moment du plan échoue ; s'il est désactivé après un déploiement fonctionnel avec un `redis_host` explicite, les pièces jointes téléchargées deviennent éphémères. |
| `redis_host` | `""` (utiliser l'IP NFS) ou un hôte réel et accessible | Élevé | Un hôte Redis inaccessible fait que `REDIS_URL` se résout mais échoue à se connecter — Sidekiq démarre mais les tâches ne sont jamais traitées ; le point d'entrée ne saute Sidekiq que lorsque `REDIS_URL` est entièrement vide. |
| `container_resources.memory_limit` | `4Gi` (par défaut) | Élevé | Le processus combiné Rails + Sidekiq est gourmand en mémoire lors des charges de travail d'importation/synchronisation ; le réduire risque un OOM. {/* TODO: verify the exact minimum safe memory floor */} |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et peuvent perturber les sessions authentifiées. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et tout domaine personnalisé configuré. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Maybe
partagée avec la variante Cloud Run se trouve dans le module `MaybeFinance_Common` —
voir **[MaybeFinance_Common](MaybeFinance_Common.md)** pour les secrets, le
démarrage de la base de données, le comportement du point d'entrée, les
sondes de santé et le stockage.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Maybe Finance sur GKE Autopilot](../labs/MaybeFinance_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Maybe Finance sur Google Cloud Run](MaybeFinance_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [MaybeFinance Common — Configuration d'application partagée](MaybeFinance_Common.md) — la configuration partagée par les deux cibles de déploiement.
