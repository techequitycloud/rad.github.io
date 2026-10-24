---
title: "Chatwoot sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Chatwoot sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chatwoot_GKE.md @ 1665a43e sha256:f82d19f045ae -->

# Chatwoot sur GKE Autopilot {#chatwoot-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chatwoot_GKE.png" alt="Chatwoot sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chatwoot est une plateforme open source multicanal de service client et
d'engagement client (e-mail, chat en direct, réseaux sociaux et boîtes de
réception de messagerie, suivi des SLA et rapports) qui sert d'alternative
conforme au RGPD à Zendesk ou Intercom. Ce module déploie Chatwoot sur **GKE
Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Chatwoot et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Chatwoot sur RAD, et comment cela se compare {#what-chatwoot-costs-on-rad-and-how-that-compares}

**Le module Chatwoot sur GKE Autopilot de RAD coûte environ 150 US$ par mois
dans votre propre projet Google Cloud, sans frais de licence
supplémentaires** — Chatwoot est open source. Dans un projet géré par RAD pour
vous, le même déploiement est facturé **111 crédits par jour** (environ 3 330
par mois, soit environ 333 US$ au prix de la recharge). Ou consultez le [guide
Cloud Run](Chatwoot_CloudRun.md) pour l'option moins chère. Si vous n'avez
besoin de Chatwoot qu'occasionnellement — pour des études, une démo, un projet
éphémère — un projet géré par RAD peut être supprimé et restauré dans les 30
jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques
dollars à la place. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Chatwoot est open source, il n'y a donc pas de frais de licence. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 US$ au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **150 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **111 crédits par jour**, environ 3 330 par mois (environ 333 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un abonnement
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par chaque application du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
publics Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de cluster GKE partagés)** | **environ 150 US$** |

Les prix de Cloud SQL et des pods Cloud Run/GKE sont les mêmes en africa-south1
(Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **GKE Autopilot ne se met pas à l'échelle à zéro.** Au moins un pod
  fonctionne toujours, de sorte que le coût ci-dessus s'applique que quelqu'un
  utilise ou non l'application ; des pods supplémentaires ne sont ajoutés que
  sous charge.

### Comment cela se compare, pour une équipe de dix agents {#how-it-compares-for-a-team-of-ten-agents}

L'équipe de Chatwoot vend **Chatwoot Cloud** hébergé par agent :

| Option | Par mois (10 agents) | Notes |
|---|---|---|
| Chatwoot Cloud, Hacker | 0 US$ | Niveau gratuit, limité |
| Chatwoot Cloud, Startups | 190 US$ (19 US$/agent) | Hébergé par Chatwoot |
| Chatwoot Cloud, Business | 390 US$ (39 US$/agent) | Hébergé par Chatwoot, le plus populaire |
| Chatwoot Cloud, Enterprise | 990 US$ (99 US$/agent) | Hébergé par Chatwoot |
| **RAD, Cloud Run, votre propre projet** | **Environ 102 US$**, plus 11 US$ une fois par déploiement | L'automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 960 crédits (96 US$)** | RAD |

- **Le prix de Chatwoot Cloud augmente avec chaque siège d'agent ; le coût de
  RAD est celui de l'infrastructure.** Pour dix agents, le coût d'exécution de
  RAD dans votre propre projet est déjà inférieur au niveau payant le moins cher
  de Chatwoot Cloud.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en
  panne.** Sur RAD, la base de données est Cloud SQL avec des sauvegardes
  automatisées, et les secrets vivent dans Secret Manager. Sur votre propre
  serveur, chacun de ces éléments est un travail que quelqu'un doit faire.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Chatwoot s'exécute dans **un projet géré par RAD pour vous**, la suppression
de l'ensemble du projet — plutôt que la suppression de ce seul module —
dissocie d'abord sa facturation, puis demande à Google de supprimer
définitivement le projet. Google le conserve, récupérable, pendant 30 jours, et
comme la facturation est déjà dissociée, rien n'est facturé pendant qu'il
attend. Contrairement à la suppression d'un module, cela ne supprime pas Cloud
SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut demander à Google de récupérer le projet
  et de rattacher son compte de facturation, puis d'exécuter **Update** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes, et une mise à jour ne facture jamais les frais de module à nouveau.
  Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte
  que quelques crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  RAD gère uniquement pour la facturation), le restaurer vous-même dans les 30
  jours — après quoi Google le supprime définitivement — et effacer à nouveau
  le seuil d'admission du niveau (100 crédits pour le niveau sandbox que la
  plupart des utilisations d'étude/démo conviennent). Google indique que la
  plupart des services fonctionnent à nouveau pleinement dans les 36 heures
  suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  a la suppression logicielle de Cloud Storage désactivée, il est donc très
  probable qu'il disparaisse dès que le projet est supprimé — même si le projet
  lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a
  quelque chose à conserver ; pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
ci-dessus est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds : environ 304 crédits (environ 30,40 US$) au prix de la recharge, et
  environ 15 à 20 minutes de temps de build (moyenne de la propre plateforme de
  RAD). La suppression ne permet d'économiser de l'argent que si Chatwoot
  resterait inutilisé pendant environ **4 jours ou plus** — dans votre propre
  projet, cela représente environ 4,99 US$ par jour, et dans un projet géré par
  RAD, c'est 111 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données
  et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, de sorte que la
  suppression de Chatwoot alors qu'une autre application partage le projet ne
  sauve que la partie calcul de Chatwoot.
- **Conserver les données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
  la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix publics Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde sur le bucket de
sauvegarde ; [Prix de Chatwoot
Cloud](https://www.chatwoot.com/pricing) ; les prix changent, vérifiez chaque
source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Chatwoot s'exécute comme une seule charge de travail Ruby on Rails qui combine
le serveur web et un worker Sidekiq en arrière-plan dans un seul pod. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Rails + worker Sidekiq colocalisé sur le port 3000, 2 vCPU / 4 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` ; l'extension `vector` (pgvector) est activée pour les fonctionnalités d'IA/recherche de Chatwoot |
| Cache et file d'attente | Redis (VM NFS hébergée par Cloud Filestore, ou externe) | Prend en charge la file d'attente de jobs de Sidekiq et la pub/sub ActionCable |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/opt/chatwoot/storage`, partagées entre les pods |
| Stockage d'objets | Cloud Storage | Un suffixe de bucket `storage` provisionné automatiquement |
| Secrets | Secret Manager | `SECRET_KEY_BASE` Rails auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` par défaut à `POSTGRES_15` ; le
  schéma de Chatwoot et les fonctionnalités basées sur pgvector le
  nécessitent.
- **Image personnalisée.** `container_image_source = "custom"` — le module Common construit
  `FROM chatwoot/chatwoot:${APP_VERSION}` et ajoute un point d'entrée cloud qui mappe les variables
  d'environnement `DB_*`/`REDIS_*` de la fondation sur la
  convention `POSTGRES_*`/`REDIS_URL` de Chatwoot et lance Sidekiq en
  arrière-plan avant d'exécuter le serveur Rails. L'image s'exécute **en
  tant que root** — correspondant à l'image amont, dont `/app`/`/app/tmp`
  sont détenus par root et non inscriptibles par le groupe, de sorte que
  l'étape `create_tmp_directories` de Rails nécessite root pour réussir.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur loopback.** `enable_cloudsql_volume
  = true`
  exécute un sidecar cloud-sql-proxy écoutant sur `127.0.0.1:5432` ; le point
  d'entrée mappe les `DB_HOST`/`DB_IP` injectés sur `POSTGRES_HOST`.
- **Deux jobs d'initialisation s'exécutent en séquence.** `db-init` (crée la
  base de données, le rôle et les autorisations — y compris une autorisation
  `cloudsqlsuperuser` afin que Chatwoot puisse créer lui-même des extensions
  Postgres) s'exécute en premier, puis `chatwoot-prepare` (`rails db:chatwoot_prepare`)
  crée/met à jour le schéma et initialise les valeurs par défaut. Il n'y a
  pas d'étape de migration dans le conteneur ; la configuration du schéma se
  fait entièrement dans ces deux Jobs avant que le conteneur de l'application
  n'ait besoin de servir le trafic.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide
  pour utiliser l'IP Redis partagée hébergée par le serveur NFS que la
  fondation injecte automatiquement.
- **`SECRET_KEY_BASE` est généré une fois et partagé** entre le processus web
  Rails et le worker Sidekiq (ils s'exécutent dans le même conteneur ici,
  mais la valeur doit également rester stable lors des redémarrages/redéploiements
  — Rails l'utilise pour signer les sessions et chiffrer les colonnes chiffrées
  d'ActiveRecord).
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **PodDisruptionBudget est activé par défaut** (`enable_pod_disruption_budget = true`, `pdb_min_available = "1"`).
- **`ENABLE_ACCOUNT_SIGNUP` par défaut à `"false"`** — l'inscription
  libre-service admin/agent est désactivée sur un helpdesk fraîchement
  déployé ; activez-la via `environment_variables` si vous souhaitez une inscription
  publique.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Chatwoot {#a-gke-autopilot--the-chatwoot-workload}

Les pods Chatwoot sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que les pods demandent réellement. Chaque pod exécute à la fois le serveur web
Rails et un processus worker Sidekiq en arrière-plan, de sorte que la charge de
travail ne doit pas être mise à l'échelle à zéro — Sidekiq est ce qui livre/reçoit
les messages de canal et traite les jobs en arrière-plan.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Chatwoot pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Chatwoot stocke toutes les données d'application (conversations, contacts,
boîtes de réception, agents, rapports) dans une instance Cloud SQL pour
PostgreSQL 15 gérée, y compris l'extension `vector` utilisée par ses
fonctionnalités d'IA/recherche. Les pods l'atteignent via le sidecar **Cloud SQL
Auth Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du
premier déploiement, le Job `db-init` crée la base de données
d'application, le rôle et les autorisations (y compris une autorisation
`cloudsqlsuperuser` afin que les appels de création d'extension de Chatwoot
réussissent), puis le Job `chatwoot-prepare` exécute `rails db:chatwoot_prepare` pour
construire le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe.

### C. Redis (cache, file d'attente et pub/sub) {#c-redis-cache-queue-and-pubsub}

Sidekiq (la file d'attente de jobs en arrière-plan de Chatwoot) et ActionCable
(mises à jour de l'interface utilisateur en temps réel) nécessitent tous deux
Redis. `enable_redis = true` par défaut ; lorsque `redis_host` est laissé vide, la
fondation injecte l'IP Redis partagée hébergée par le serveur NFS en tant que
`REDIS_HOST`, et le point d'entrée du conteneur construit `REDIS_URL` à
partir de celle-ci au démarrage. Pointez `redis_host`/`redis_port`/`redis_auth`
vers une instance Cloud Memorystore dédiée pour une charge de travail de
production plus lourde.

> **Sidekiq nécessite Redis 6.2 ou plus récent, et le Redis hébergé sur NFS est
> 6.0.** Le Redis partagé sur la VM NFS exécute la version 6.0.16, et Sidekiq 7
> refuse de démarrer avec elle. L'interface web fonctionne toujours (le point
> d'entrée met Sidekiq en arrière-plan), de sorte que le déploiement semble
> sain alors qu'aucun job en arrière-plan ne s'exécute. Pointez `redis_host`
> vers une instance Redis 6.2+ — par exemple Memorystore, via `create_redis = true`
> dans Services_GCP, qui provisionne Redis 7.2.

- **Console :** Memorystore → Instances Redis (si vous utilisez une instance
  dédiée).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^REDIS_'
  gcloud redis instances list --project "$PROJECT" --region "$REGION"
  ```

Voir [App_GKE](App_GKE.md) pour la façon dont le fallback Redis hébergé sur NFS
et l'intégration Memorystore sont câblés.

### D. Cloud Storage et persistance des fichiers (NFS) {#d-cloud-storage--file-persistence-nfs}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder
l'accès. Séparément, les pièces jointes de Chatwoot résident sur **NFS (Cloud
Filestore)** à `/opt/chatwoot/storage`, partagées entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Chatwoot est généré automatiquement et stocké dans
Secret Manager : `SECRET_KEY_BASE` (clé de signature de session Rails / de
chiffrement ActiveRecord, partagée de manière identique entre les processus web
et Sidekiq). Le mot de passe de la base de données est géré séparément par la
fondation. Sur GKE, les secrets sont projetés dans les pods via le pilote CSI
Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements). Un domaine personnalisé avec un certificat géré par Google
peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods (les processus Rails et Sidekiq, puisqu'ils
partagent un conteneur) sont acheminées vers Cloud Logging ; les métriques GKE
et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

Voir [App_GKE](App_GKE.md) pour la gestion des vérifications de disponibilité et
le câblage des politiques d'alerte.

---

## 3. Comportement de l'application Chatwoot {#3-chatwoot-application-behaviour}

- **La configuration de la base de données au premier déploiement s'exécute en
  deux Jobs chaînés.** `db-init` (image `postgres:15-alpine`) se connecte à
  Cloud SQL, crée de manière idempotente le rôle et la base de données, accorde
  les privilèges, accorde `cloudsqlsuperuser` au rôle de l'application (nécessaire
  car l'utilisateur de l'application Cloud SQL n'est pas un véritable super-utilisateur
  Postgres et `db:chatwoot_prepare` de `schema.rb` appelle `enable_extension` pour
  plusieurs extensions), et pré-crée `vector`, `pg_stat_statements`,
  `pg_trgm` et `pgcrypto` de manière défensive. `chatwoot-prepare` dépend
  alors de `db-init` et exécute `bundle exec rails db:chatwoot_prepare` en utilisant l'**image
  d'application Chatwoot construite** (pas une image client générique) afin que
  la chaîne d'outils et la configuration Rails complètes soient présentes. Les
  deux jobs s'exécutent sur `execute_on_apply = true`.
- **Pas de migrations dans le conteneur.** La création/mise à jour du schéma est
  entièrement gérée par le Job d'initialisation `chatwoot-prepare` avant que le
  conteneur de l'application ne soit censé servir le trafic — le point d'entrée
  d'exécution n'exécute pas `rails db:migrate`.
- **Alias de variables d'environnement de la base de données.** La plateforme
  injecte `DB_HOST` (le sidecar proxy, `127.0.0.1` sur GKE),
  `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; le point
  d'entrée cloud (`cloud-entrypoint.sh`, intégré à l'image) les mappe sur la
  convention `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_DATABASE`/
  `POSTGRES_USERNAME`/`POSTGRES_PASSWORD` de Chatwoot.
  {/* TODO: could not confirm whether App_GKE also forwards db_host_env_var_name / db_user_env_var_name aliasing vars for Chatwoot; the entrypoint does its own mapping regardless, so these Foundation-mirror variables in Group 16 are effectively unused for this app. */}
- **L'URL Redis est auto-réparatrice.** Si `REDIS_URL` n'est pas déjà
  défini, le point d'entrée le construit à partir des `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`
  injectés — cela couvre à la fois le cas explicite `redis_host` et le cas de
  fallback NFS par défaut, de sorte que laisser `redis_host` vide produit
  toujours un `REDIS_URL` fonctionnel au démarrage du conteneur.
- **Sidekiq s'exécute en colocation, en arrière-plan.** `cloud-entrypoint.sh` démarre
  `bundle exec sidekiq -C config/sidekiq.yml &` avant d'exécuter le serveur Rails ; un
  `trap` sur `TERM`/`INT` arrête Sidekiq en même
  temps que le conteneur. Parce que Sidekiq traite les jobs en arrière-plan
  (livraison de canaux, notifications, rapports) uniquement tant qu'un pod est
  en vie, conservez `min_instance_count >= 1` en production.
- **Compte administrateur/premier lancement.** L'interface utilisateur
  d'intégration de Chatwoot crée le premier compte administrateur de manière
  interactive à `/installation/onboarding` lors de la première visite — il n'y a pas de
  secret d'identifiant administrateur auto-généré pour ce module.
  {/* TODO: could not confirm the exact first-run onboarding route/behaviour from the wiring files alone; verified against general Chatwoot self-hosted conventions, not this repo's source. */}
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /` ; la
  sonde de vivacité est `GET /health`, car elle est mise en miroir dans la
  vérification de santé de la passerelle, qui nécessite un 200 littéral et
  `/` redirige. La sonde de disponibilité définie par le module
  Common (`initial_delay_seconds = 30`) cible `/`. Laissez du temps au
  premier démarrage — `chatwoot-prepare` doit se terminer avant même que le
  conteneur de l'application ne démarre.
- **Signal d'arrêt du proxy Cloud SQL.** Les deux Jobs d'initialisation
  `wget`/`curl`-POST vers le point de terminaison
  `--quitquitquit` du sidecar proxy (`127.0.0.1:9091/quitquitquit`) à la sortie afin que le
  pod du Job se termine au lieu de rester bloqué sur un sidecar actif.
- **Les mises à jour recréent le pod au lieu de le déployer.** Parce que
  `enable_nfs = true` par défaut, `App_GKE` déploie la charge de travail
  avec la stratégie `Recreate` plutôt que `RollingUpdate` — deux pods
  en concurrence pour le même volume de pièce jointe NFS et la base de données
  partagée se bloqueraient sur le pod de surtension pendant un déploiement
  (vérifié en direct via un déploiement NFS Chatwoot). Une mise à jour de
  version ou un changement de configuration qui touche le modèle de pod
  entraîne donc une brève interruption pendant que l'ancien pod se termine
  avant que le nouveau ne démarre, plutôt qu'un déploiement sans
  interruption.
- **Inspecter les jobs d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<chatwoot-prepare-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'POSTGRES_|REDIS_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Chatwoot sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chatwoot` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `v4.15.1` | Tag d'image `chatwoot/chatwoot` utilisé comme base de build personnalisé. Incrémenter pour déclencher une reconstruction. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources.cpu_limit` | `2000m` | 2 vCPU — Rails + worker Sidekiq colocalisé. |
| `container_resources.memory_limit` | `4Gi` | 4 Gio minimum recommandé ; les deux processus partagent le conteneur. |
| `min_instance_count` | `1` | Maintenir à 1 pour que le worker Sidekiq (et ActionCable) reste actif. |
| `max_instance_count` | `5` | Plafond de mise à l'échelle horizontale standard. |
| `container_port` | `3000` | Port du serveur Rails de Chatwoot. |
| `container_image_source` | `custom` | Construit sur mesure à partir de `chatwoot/chatwoot` ; ne pas définir à `prebuilt`. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Chatwoot. |
| `workload_type` | `null` → `Deployment` | Déploiement standard (aucun PVC nécessaire par défaut). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Limite les évictions volontaires simultanées de pods. |
| `pdb_min_available` | `"1"` | Maintient au moins un pod (et son worker Sidekiq) disponible pendant les perturbations. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les pièces jointes persistent et soient partagées. |
| `nfs_mount_path` | `/opt/chatwoot/storage` | Où Chatwoot stocke les pièces jointes téléchargées. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la mise en file d'attente Sidekiq et la pub/sub ActionCable ; transmis à la fondation sans condition. |
| `redis_host` | `""` | Vide utilise l'IP Redis partagée hébergée par le serveur NFS que la fondation injecte. |
| `redis_port` | `6379` | Port TCP Redis. |
| `redis_auth` | `""` | Mot de passe AUTH Redis, si l'instance cible en nécessite un. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par la sortie de configuration du module Common (également codé en dur dans le `config.database_type` Common) ; Chatwoot nécessite PostgreSQL 15+ avec pgvector. |
| `application_database_name` | `chatwoot` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `chatwoot` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |
| `enable_postgres_extensions` | `true` (valeur par défaut Common) | Active `vector` après le provisionnement ; `db-init.sh` le pré-crée également de manière défensive. |

### Groupe 1 — Recherche et intégrations optionnelles {#group-1--search--optional-integrations}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `elasticsearch_url` | `""` | Point de terminaison Elasticsearch optionnel (par exemple de `Elasticsearch_GKE`) pour la recherche en texte intégral de Chatwoot. Laisser vide pour désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch ; laisser vide lorsque `xpack.security.enabled` est faux. |
| `elasticsearch_password_secret` | `""` | ID du secret Secret Manager contenant le mot de passe Elasticsearch ; lorsqu'il est défini, injecté en tant que `ELASTICSEARCH_PASSWORD` et accordé `secretAccessor`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Chatwoot. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy Auth) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `chatwoot-prepare`) et d'importation (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — paramètres
> workload-type/PVC non concordants, IAP activé sans identités autorisées,
> `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days`
> hors de portée. Une configuration invalide échoue à la **planification** avec
> une erreur claire et nommée avant la création de toute ressource, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixé par Common) | Critique | Le schéma de Chatwoot et la recherche basée sur pgvector nécessitent Postgres 15+ ; tout autre moteur casse `chatwoot-prepare`. |
| `application_database_name` / `application_database_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais changer | Critique | Sa rotation invalide chaque session/cookie signé et rend les colonnes chiffrées d'ActiveRecord définitivement illisibles ; Sidekiq échouera également à déchiffrer les jobs en cours. |
| `enable_redis` | `true` (transmis sans condition) | Critique | Sidekiq (jobs en arrière-plan, livraison de canaux) et ActionCable (interface utilisateur en temps réel) nécessitent tous deux Redis ; le désactiver interrompt silencieusement la livraison des messages même si l'interface web se charge. |
| `min_instance_count` | `1` | Élevé | En dessous de 1, le worker Sidekiq colocalisé ne s'exécute pas entre les requêtes, de sorte que les jobs en arrière-plan (interrogation de canaux, notifications, rapports) stagnent entre les démarrages à froid. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les pièces jointes téléchargées éphémères — perdues lors de la recréation du pod. Le laisser activé change également la stratégie de déploiement en `Recreate` (brève interruption par mise à jour) au lieu de `RollingUpdate` — attendu, pas un bug. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité de la base de données sur GKE. |
| Ordre des jobs `chatwoot-prepare` | S'exécute après `db-init` (`depends_on_jobs = ["db-init"]`) | Élevé | L'exécution de la préparation du schéma avant l'existence des autorisations de base de données/rôle/extension échoue au Job (`must be superuser` sur `CREATE EXTENSION`, ou la base de données/le rôle manquant entièrement). |
| `container_image_source` | `custom` | Élevé | Chatwoot est une image pré-construite Docker Hub enveloppée dans un point d'entrée personnalisé (mappage d'env + lancement de Sidekiq) ; passer à `prebuilt` ignore ce wrapper et le conteneur ne mappera pas `DB_*`/`REDIS_*` correctement. |
| `pdb_min_available` | `"1"` | Moyen | La maintenance/les mises à niveau volontaires des nœuds pourraient autrement évincer le seul pod exécutant Sidekiq, interrompant le traitement en arrière-plan. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et toutes les URL de webhook/rappel de canal configurées. |
| `ENABLE_ACCOUNT_SIGNUP` | `"false"` (par défaut) | Moyen | Laisser l'inscription publique en libre-service activée sur un helpdesk accessible sur Internet permet à quiconque d'enregistrer un compte agent/administrateur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données de conversation/client. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Chatwoot
partagée avec la variante Cloud Run est décrite dans le module
Chatwoot_Common (`modules/Chatwoot_Common`) ; voir **[Chatwoot_Common](Chatwoot_Common.md)**
pour les secrets, le démarrage de la base de données, l'image/le point d'entrée
du conteneur, les sondes de santé et le stockage d'objets.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Chatwoot sur GKE Autopilot](../labs/Chatwoot_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Chatwoot Common — Configuration d'application partagée](Chatwoot_Common.md) — la configuration partagée par les deux cibles de déploiement.
