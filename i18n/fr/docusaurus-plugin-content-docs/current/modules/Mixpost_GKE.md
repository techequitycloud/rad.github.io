---
title: "Mixpost sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Mixpost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mixpost_GKE.md @ 40c83c3f sha256:021feead58f3 -->

# Mixpost sur GKE Autopilot {#mixpost-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mixpost_GKE.png" alt="Mixpost sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mixpost est une plateforme open source et auto-hébergée de planification et de
gestion des médias sociaux — une alternative à Buffer/Hootsuite pour composer,
planifier, publier et analyser des publications sur plusieurs comptes sociaux à
partir d'un tableau de bord unique. Il s'agit d'une application Laravel (nginx +
PHP-FPM + supervisord exécutant le worker de file d'attente et le planificateur
dans un seul conteneur). Ce module déploie Mixpost sur **GKE Autopilot** sur la
base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Mixpost et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Mixpost sur RAD, et comparaison {#what-mixpost-costs-on-rad-and-how-that-compares}

**L'exécution de Mixpost dans votre propre projet GCP coûte environ 142,62 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | ~142,62 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~142 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Pourquoi les deux colonnes diffèrent.** Le chiffre pour les projets gérés par RAD inclut les frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre les frais de gestion d'un cluster par compte de facturation, ce que le chiffre pour les projets personnels suppose. Il est estimé à partir des prix catalogue de Google, car il n'y a pas encore suffisamment d'historique GKE géré par RAD pour le mesurer, de sorte que la confirmation de déploiement ne le cite pas. Une deuxième application GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **142,62 $** |

### Comparaison {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour Mixpost avec lequel comparer, donc la base de référence honnête est un VPS nu : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes monétaires, et ne l'est généralement pas — pour un outil de planification sociale d'une petite équipe, le véritable argument est ce que RAD gère pour vous (sauvegardes, correctifs, secrets, surveillance) plutôt que le prix affiché.
- Quoi qu'il en soit, il s'agit d'un outil de planification sociale pour une petite équipe, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le point clé pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de
calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant
qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être utilisée comme moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google
de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
Update sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une
vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais
de module. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement),
donc une restauration ne coûte normalement aucun crédit.

Ce dont cela a besoin : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela,
Google le supprime définitivement — et la restauration est admise comme la création d'un
nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du
niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo
conviennent). Google indique que la plupart des services sont à nouveau pleinement
opérationnels dans les 36 heures suivant une restauration.

**Une lacune réelle :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du
projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est
donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet
lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous
souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30
jours ci-dessus), l'alternative est de supprimer Mixpost purement et simplement et de le
redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les builds sont
inclus) — 110 crédits.

La suppression ne permet d'économiser de l'argent que si Mixpost reste inutilisé assez longtemps
pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien —
par rapport au total du projet ci-dessus, cela représente environ 2 jours ou plus. La majeure
partie du coût d'exécution ici est généralement la base de données et la VM de fichier/cache
partagée ; elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la
suppression de cette application pendant que quelque chose d'autre partage le projet ne permet
d'économiser que la partie de calcul propre à cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un bucket à l'intérieur
du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de
supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque
  participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance
  toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec
  le client. Si le portefeuille est faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
  ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Mixpost s'exécute comme une charge de travail web unique et autonome (l'image
officielle `inovector/mixpost`). Le déploiement connecte un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | pod nginx + PHP-FPM + supervisord sur le port 80, 2 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` |
| File d'attente, cache et sessions | Redis | Activé par défaut ; pilote `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` ; utilise l'IP du serveur NFS co-localisé par défaut si aucun hôte externe n'est spécifié |
| Persistance des fichiers | Cloud Filestore (NFS) | Les médias/téléchargements persistent sous `/mnt/nfs`, partagés entre les pods ; également la source d'hôte Redis par défaut |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement par `Mixpost_Common` |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`Mixpost_Common` définit `database_type = "MYSQL_8_0"` et
  `DB_CONNECTION = "mysql"`) ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur une boucle locale TCP
  simple, et non une socket.** La variante définit `DB_HOST = 127.0.0.1` ; sur GKE, le
  Cloud SQL Auth Proxy (`enable_cloudsql_volume = true`) est un écouteur TCP simple sur
  `127.0.0.1:3306` (contrairement à la socket Unix de Cloud Run). **Conservez
  ce `true`** — le désactiver fait que le job `db-init` se connecte
  sur l'IP privée et se termine avant le démarrage du proxy, de sorte que son
  signal d'arrêt `quitquitquit` est manqué et le sidecar du proxy s'exécute
  indéfiniment, bloquant le job.
- **Redis est activé par défaut et effectivement requis.** `enable_redis = true`
  connecte `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER` à
  `redis` (reculant à `sync`/`file` uniquement
  lorsqu'il est désactivé). Lorsque `redis_host` est vide, le module utilise
  par défaut l'IP du serveur NFS — une garde de validation au moment de la
  planification impose que soit `redis_host` est défini, soit
  `enable_nfs` est `true`.
- **`min_instance_count = 1`, `max_instance_count = 5`.** Contrairement au
  démarrage à froid par défaut de la variante Cloud Run, GKE maintient au moins
  un pod en fonctionnement continu, de sorte que le planificateur Laravel géré
  par supervisord et le worker de file d'attente fonctionnent sans cron externe
  — la convention CLAUDE.md d'externalisation du travail planifié via Cloud
  Scheduler (utilisée pour `schedule:run` de la variante Cloud Run) ne
  s'applique **pas** ici.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/mnt/nfs`)
  pour le stockage partagé de médias/fichiers, et sert également d'hôte Redis
  par défaut.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **Pas de job de migration séparé.** L'image `inovector/mixpost` pré-construite
  exécute `php artisan migrate --force` et initialise le compte administrateur lui-même à
  chaque démarrage via son point d'entrée supervisord intégré ; le seul job
  d'initialisation est la création de base de données/utilisateur
  `db-init` idempotente.
- **Mappage des variables d'environnement de la base de données Laravel.**
  `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"` et `db_name_env_var_name = "DB_DATABASE"`
  afin que les `DB_USER`/`DB_NAME` à portée locataire créés par la
  fondation soient exposés sous les noms que `env()` de Laravel lit
  réellement — ce n'est pas configurable par l'opérateur.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager ;
  la variante GKE ajoute le suffixe `-gke` à son préfixe de ressource
  afin que le secret n'entre pas en collision avec un déploiement Cloud Run du
  même locataire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.
L'espace de noms et les autres identifiants sont indiqués dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Mixpost {#a-gke-autopilot--the-mixpost-workload}

Les pods Mixpost sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Comme la charge de travail est par défaut
basée sur NFS, le déploiement utilise la stratégie `Recreate` (une mise à jour
glissante exécuterait deux pods sur le même volume NFS et la même base de
données partagée et provoquerait un blocage).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Mixpost pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mixpost stocke toutes les données de l'application (comptes, publications,
métadonnées multimédias, utilisateurs) dans une instance Cloud SQL pour MySQL
8.0 gérée. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** qui
écoute sur `127.0.0.1:3306` (boucle locale TCP simple — pas une socket Unix sur
GKE). Lors du premier déploiement, le job `db-init` crée la base de données
de l'application (`utf8mb4`/`utf8mb4_0900_ai_ci`), l'utilisateur et les
autorisations, puis signale au sidecar du proxy de s'arrêter.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe se trouvent tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Redis — file d'attente, cache et sessions {#c-redis--queue-cache--sessions}

Le pipeline de publication en arrière-plan de Mixpost, le cache de réponse et
les sessions passent tous par Redis lorsque `enable_redis = true` (par défaut). Aucune
instance Memorystore dédiée n'est provisionnée par ce module — à moins que
`redis_host` ne soit remplacé par une instance externe, Redis est censé être
accessible à l'adresse IP du serveur NFS (la même VM Compute Engine qui sert NFS
exécute également Redis dans la convention d'infrastructure partagée de ce
répertoire).

- **Console :** Memorystore → Instances Redis (uniquement si vous pointez
  `redis_host` vers une instance gérée) ; sinon Compute Engine → Instances de
  VM pour l'hôte NFS/Redis.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'QUEUE_CONNECTION|CACHE_DRIVER|SESSION_DRIVER|REDIS'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Cloud Storage et persistance des fichiers (NFS) {#d-cloud-storage--file-persistence-nfs}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder
l'accès. Séparément, l'arborescence des médias/téléchargements de Mixpost se
trouve sur **NFS (Cloud Filestore)** à `/mnt/nfs`, partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Mixpost est généré automatiquement : la clé
`APP_KEY` de Laravel (`secret-<resource_prefix>-gke-mixpost-app-key`), une valeur aléatoire de
32 caractères encodée en base64 au format natif `base64:<value>` de Laravel. Le
mot de passe de la base de données est géré séparément par la fondation. Sur
GKE, les secrets sont projetés dans les pods via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mixpost"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements). Un domaine personnalisé avec un certificat géré par Google
peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des tests de disponibilité et des politiques
d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Mixpost {#3-mixpost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `scripts/db-init.sh` en utilisant `mysql:8.0-debian`. Il
  se connecte via le sidecar Cloud SQL Auth Proxy sur TCP (`--get-server-public-key`,
  nécessaire car `caching_sha2_password` refuse d'envoyer un mot de passe sur une
  connexion en boucle locale non chiffrée), crée de manière idempotente la base
  de données de l'application avec `utf8mb4`/`utf8mb4_0900_ai_ci`, supprime
  et recrée l'utilisateur de l'application, accorde les privilèges, vérifie que
  l'utilisateur de l'application peut se connecter, puis envoie
  `quitquitquit` au sidecar du proxy sur le port 9091 pour l'arrêter. Le job
  peut être relancé en toute sécurité (`execute_on_apply = true`, `max_retries = 1`).
- **Pas de job de migration séparé.** Le point d'entrée supervisord intégré
  de l'image `inovector/mixpost` pré-construite exécute `php artisan migrate --force` et
  initialise le compte administrateur à chaque démarrage ; il n'y a pas de job
  d'initialisation de migration distinct.
- **Les valeurs par défaut du compte administrateur sont intégrées à l'image,
  non configurables via ce module.** La connexion initiale utilise par défaut
  `admin@example.com` / `changeme` quelle que soit la valeur de
  `mixpost_admin_email` — cette variable est déclarée pour le transfert de variante
  mais n'est **pas actuellement injectée** dans la configuration en cours
  d'exécution (l'image initialise elle-même le compte administrateur). Changez
  le mot de passe administrateur immédiatement après la première connexion.
- **Mappage des variables d'environnement de la base de données.** La fondation
  injecte `DB_HOST` (`127.0.0.1`, le sidecar du proxy),
  `DB_PORT` et `DB_PASSWORD` ; `main.tf` code en dur
  `db_user_env_var_name = "DB_USERNAME"` et `db_name_env_var_name = "DB_DATABASE"` afin que l'utilisateur/nom de la base de
  données à portée locataire atterrisse sur les noms de variables natifs de
  Laravel.
- **Câblage Redis.** `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER` sont
  définis sur `redis` lorsque `enable_redis = true` (par défaut),
  reculant à `sync`/`file` sinon. `Mixpost_Common` ne
  définit **pas** ces valeurs lui-même — les locaux `main.tf` de la
  variante GKE les fusionnent en fonction de `enable_redis`.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour
  terminent l'ancien pod avant de démarrer le nouveau, évitant ainsi que deux
  pods ne se bloquent sur le volume NFS partagé et les verrous de la base de
  données.
- **Les sondes de santé sont TCP, pas HTTP, au niveau du pod.** Mixpost répond
  `/` avec une redirection `302` vers
  `https://<app_url>/` ; la sonde HTTP kubelet GKE **suit les redirections**,
  atterrissant sur `https://<pod-ip>:443` où rien n'écoute — connexion refusée,
  échec de la sonde, boucle de redémarrage (pods `0/1`) même si
  l'application fonctionne correctement sur `:80`. `startup_probe_config`
  et `health_check_config` (les variables que la fondation utilise réellement
  pour `startupProbe`/`livenessProbe` du déploiement) sont donc par
  défaut `type = "TCP"` sur le port 80. (La sonde de Cloud Run ne suit pas
  les redirections, c'est pourquoi la même sonde HTTP fonctionne sans
  modification sur cette variante.) Les variables séparées
  `startup_probe`/`liveness_probe` transférées dans la configuration de
  l'application sont par défaut HTTP et sont cosmétiques au niveau de l'objet
  de configuration — les véritables sondes de pod proviennent de
  `startup_probe_config`/`health_check_config`.
- **Le planificateur s'exécute en continu dans le pod.** Avec `min_instance_count = 1`,
  un pod est toujours en cours d'exécution, de sorte que le planificateur
  Laravel géré par supervisord et le worker de file d'attente publient les
  publications planifiées sans aucun câblage Cloud Scheduler externe (un
  contraste avec le démarrage à froid par défaut de la variante Cloud Run, qui
  nécessite un déclenchement cron `schedule:run` externalisé).
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|APP_KEY|QUEUE_CONNECTION'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Mixpost sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mixpost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `inovector/mixpost` déployé directement (pré-construit, pas de build personnalisé). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie `inovector/mixpost` directement ; transféré explicitement afin que la fondation ne le traite pas comme un build personnalisé sans Dockerfile. |
| `cpu_limit` | `2000m` | 2 vCPU par défaut. |
| `memory_limit` | `2Gi` | 2 GiB par défaut. |
| `min_instance_count` | `1` | Maintient le planificateur/worker de file d'attente Laravel dans le pod en fonctionnement continu. |
| `max_instance_count` | `5` | Plafond maxReplicas HPA. |
| `container_port` | `80` | nginx + PHP-FPM servent du HTTP simple. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale TCP) — requis sur GKE ; le désactiver bloque le job `db-init`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur Mixpost. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP `/`, délai 90s, période 15s, failure_threshold 20 | La sonde de démarrage réelle au niveau du pod. TCP évite le piège de la redirection 302. |
| `health_check_config` | TCP `/`, délai 120s, période 30s, failure_threshold 3 | La sonde de vivacité réelle au niveau du pod. TCP pour la même raison. |
| `startup_probe` / `liveness_probe` | HTTP `/` (90s / 120s) | Transféré dans l'objet de configuration de l'application ; cosmétique — remplacé par les sondes TCP ci-dessus pour la spécification réelle du déploiement. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut pour les médias/téléchargements partagés, et sert également de source d'hôte Redis par défaut. |
| `nfs_mount_path` | `/var/www/html/storage/app/public` | Où Mixpost stocke les médias/téléchargements. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Connecte `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` à `redis`. La garde au moment de la planification exige que `redis_host` soit défini ou `enable_nfs = true`. |
| `redis_host` | `""` | Remplacer pour pointer vers une instance Redis/Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis, si l'instance cible en requiert un. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Mixpost_Common` ; non modifiable pour un autre moteur. |
| `application_database_name` | `mixpost` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mixpost` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

### Groupe 23 — Paramètres de l'application Mixpost {#group-23--mixpost-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mixpost_admin_email` | `admin@example.com` | Déclaré pour le transfert de variante ; **non actuellement injecté dans la configuration en cours d'exécution** — l'image initialise `admin@example.com` / `changeme` elle-même indépendamment. |
| `mail_from_name` | `Mixpost` | Nom d'affichage de l'expéditeur sur les e-mails sortants. |
| `mail_from_address` | `mixpost@example.com` | Adresse de l'expéditeur sur les e-mails sortants. |

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
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Mixpost. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'accès de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Le propre `Mixpost_GKE` de `validation.tf` ajoute quatre gardes supplémentaires (ordre min/max des instances, source d'hôte Redis, identifiants OAuth IAP, volume Cloud SQL vs `database_type = "NONE"`). Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixe) | Critique | Non modifiable pour un autre moteur ; `Mixpost_Common` code en dur MySQL quelle que soit la valeur nominale de cette variable. |
| `application_database_name` / `application_database_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `APP_KEY` (auto-généré) | Ne jamais changer | Critique | La rotation de la clé Laravel après le premier démarrage invalide les données de session/cookie chiffrées et tous les champs de base de données chiffrés. |
| `enable_cloudsql_volume` | `true` | Critique | Le désactiver fait que le signal d'arrêt `db-init` du job `quitquitquit` manque le proxy pas encore démarré, bloquant le job indéfiniment sur GKE. |
| `enable_redis` + `redis_host` / `enable_nfs` | `true` + NFS activé, ou un `redis_host` explicite | Élevé | L'activation de Redis sans source d'hôte (pas de `redis_host`, pas de NFS) laisse `REDIS_HOST` vide — bloqué au moment de la planification par `validation.tf`, mais désactiver les deux ou les laisser vides interrompt la mise en file d'attente, la mise en cache et les sessions. |
| `startup_probe_config` / `health_check_config` | `type = "TCP"` | Élevé | Le passage à HTTP réintroduit l'échec de la redirection 302 vers `:443` — le déploiement redémarre en boucle à `0/1` même si l'application est saine. |
| `enable_nfs` | `true` | Élevé | Le désactiver supprime à la fois la persistance des médias partagés et (sauf si `redis_host` est défini) l'hôte Redis par défaut, dégradant la fiabilité de la publication. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à `0` arrête le planificateur Laravel et le worker de file d'attente dans le pod — les publications sociales planifiées cessent de publier silencieusement. |
| `mixpost_admin_email` | Récupérer les véritables identifiants après le déploiement | Moyen | La variable n'est pas injectée dans la configuration en cours d'exécution ; la première connexion est toujours `admin@example.com` / `changeme` indépendamment — changez-la immédiatement après la première connexion. |
| `memory_limit` | `2Gi` | Élevé | En dessous de l'ensemble de travail pour PHP-FPM + les workers gérés par supervisord, les pods OOM sous charge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS et toutes les URI de redirection OAuth de plateforme sociale enregistrées. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Mixpost
(le secret `APP_KEY`, le script `db-init` et les variables
d'environnement fusionnées dans le conteneur) est partagée avec la variante
Cloud Run via le module interne `Mixpost_Common`, qui n'est pas déployé
directement et n'a pas encore son propre guide de configuration.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Mixpost sur GKE Autopilot](../labs/Mixpost_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mixpost Common — Configuration d'application partagée](Mixpost_Common.md) — la configuration partagée par les deux cibles de déploiement.
