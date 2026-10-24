---
title: "Plane sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Plane sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Plane_GKE.md @ 1665a43e sha256:f82fe3d04a71 -->

# Plane sur GKE Autopilot {#plane-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Plane_GKE.png" alt="Plane sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Plane est un outil open source de gestion de projet et de suivi des problèmes
(une alternative à Jira / Linear / Asana) couvrant les problèmes, les sprints,
les cycles, les modules et les feuilles de route des produits derrière une
interface utilisateur web moderne. Ce module déploie Plane sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Plane et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Plane sur RAD, et comment cela se compare {#what-plane-costs-on-rad-and-how-that-compares}

**L'exécution de Plane dans votre propre projet Google Cloud coûte environ
149,81 $ US/mois en infrastructure, plus des frais de module uniques de 300
crédits RAD** (dimensionnés à 2 vCPU / 4 GiB sur les pods GKE Autopilot). RAD
facture les frais de module une seule fois, au moment du déploiement — jamais
plus lors d'une mise à jour — plus le temps de build mesuré en crédits ;
l'utilisation de Google Cloud elle-même est facturée à votre propre compte de
facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les
mêmes ressources sont mesurées toutes les heures en crédits au prix catalogue
plus la marge de RAD — environ 116 crédits/jour — et les frais de module sont
inférieurs de 10 %, soit 270 crédits. Voir "Mettez-le en pause gratuitement"
ci-dessous pour savoir comment un déploiement Plane géré par RAD peut être
arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin.
(ou consultez le [guide Cloud Run](Plane_CloudRun.md) pour l'option à moindre
coût)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 300 crédits (une fois) | 270 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~149,81 $ US/mois, facturés à votre propre compte de facturation au prix catalogue de Google | ~116 crédits/jour, mesurés toutes les heures au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **149,81 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les
applications GKE exécutées dans le même projet, il est donc de 0 $ si c'est
votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Les propres créateurs de Plane vendent également **Plane Cloud**, dont le
  niveau payant le moins cher (Pro) est de **8 $/utilisateur/mois** (6
  $/utilisateur/mois facturés annuellement) — vérifié sur leur page de prix le
  8 octobre 2026. Une équipe de 14 personnes paierait plus par mois en sièges
  Plane Cloud seuls que la facture d'infrastructure totale de ce déploiement,
  sans limite de sièges ; une équipe de 2-3 personnes paie moins sur Plane
  Cloud. L'auto-hébergement échange le plafond par siège contre un coût
  d'infrastructure forfaitaire qui ne croît pas avec les effectifs.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du
  système d'exploitation/de la base de données, effectuez et testez les
  sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret
  Manager et la surveillance gèrent les trois pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite
pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer le projet lui-même — la
suppression logicielle récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne détruit pas la base de données, aucune
VM, ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé
pendant qu'il attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du
projet — demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes : c'est une vérification, pas une reconstruction, et une mise à jour
ne facture jamais les frais de module à nouveau. L'ensemble de la restauration
ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build pour
une chaîne de déploiements typique. Ce qu'il faut : vous devez être
propriétaire du projet (pas seulement faire gérer sa facturation par RAD),
vous devez le restaurer vous-même dans les 30 jours — après cela, Google le
supprime définitivement — et la restauration est admise comme la création d'un
nouveau projet, de sorte que votre solde de crédits achetés doit toujours
dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart
des études et des démonstrations utilisent). Google indique que la plupart des
services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un
bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de
Cloud Storage explicitement désactivée, de sorte que le bucket de sauvegarde
est très probablement parti dès que vous supprimez le projet — même si le
projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce
déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde
(vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour
une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **projet personnel** (ou un projet géré par RAD au-delà
de sa fenêtre de restauration de 30 jours), consiste à supprimer Plane
purement et simplement et à le redéployer plus tard. Un redéploiement coûte à
nouveau les frais de module plus les builds — environ **303-306 crédits** au
total pour ce module.

La suppression ne permet d'économiser de l'argent que si Plane reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son
propre coût d'exécution — pour ce module, cela représente environ 7 jours ou
plus d'inactivité, sur la base de son coût d'exécution de 149,81 $ US/mois
mentionné ci-dessus. La majeure partie de ce coût d'exécution est
généralement la base de données et toute VM de fichier/cache partagée, et
elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise,
donc la suppression de cette application seule n'économise que sa propre part
de calcul si quelque chose d'autre partage le projet.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est interrompue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la
  propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Resource
Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration. [https://plane.so/pricing](https://plane.so/pricing)

## 1. Vue d'ensemble {#1-overview}

La pile auto-hébergée de Plane en amont est multi-services (`web` / `space` /
`admin` frontends, `api`, `worker` + `beat` workers Celery, un
serveur temps réel `live`, et un job `migrator`). Ce module **ne**
connecte **pas** ces services séparément. Au lieu de cela, il déploie
l'**image communautaire tout-en-un** publiée par Plane (`makeplane/plane-aio-community`), qui
regroupe api + worker + beat + space + admin + live + migrator derrière un
**proxy inverse Caddy interne sur le port 80**, exécuté sous supervisord — de
sorte qu'un seul déploiement GKE expose toute l'application. Un Dockerfile/point
d'entrée de wrapper mince se superpose à cette image pour composer les chaînes
de connexion attendues par Plane (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`) à
partir des valeurs discrètes injectées par la plateforme.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiement unique exécutant l'image `plane-aio-community` (build personnalisé), port 80, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Fixé à `POSTGRES_15` par `Plane_Common` ; accessible via le sidecar Cloud SQL Auth Proxy sur la boucle locale |
| Broker de messages | RabbitMQ (`rabbitmq:3.13-management-alpine`) | Déployé en tant que déploiement `additional_services` in-cluster (`INGRESS_TRAFFIC_INTERNAL_ONLY`), requis par le worker/beat Celery de Plane |
| Backend de cache / file d'attente | Redis | `enable_redis = true` par défaut ; se résout à l'adresse IP de la VM NFS partagée lorsqu'aucun `redis_host` explicite n'est défini |
| Persistance de fichiers | Cloud Filestore (NFS) | Activé par défaut principalement pour héberger l'instance Redis partagée, pas les données d'application Plane |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné automatiquement, mais le câblage de téléchargement de fichiers est un **TODO ouvert** — voir ci-dessous |
| Secrets | Secret Manager | `SECRET_KEY` et `LIVE_SERVER_SECRET_KEY` Django auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel (activé par défaut) avec un certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **L'image tout-en-un est un build personnalisé, non pré-construit.** `Plane_Common`
  définit `image_source = "custom"` et construit un Dockerfile de wrapper mince `FROM
  makeplane/plane-aio-community:<version>` ;
  le point d'entrée compose `DATABASE_URL`/`REDIS_URL`/`AMQP_URL` avant de
  passer la main au propre `/app/start.sh` de Plane.
- **`application_version` est par défaut `"stable"`, pas `"latest"`.** L'image
  upstream `plane-aio-community` ne publie pas de tag `latest`, donc la propre
  valeur par défaut de la variable `Plane_GKE` est déjà épinglée ; si
  `latest` est fourni malgré tout, le mappage d'argument de build dans
  `Plane_Common` substitue `"stable"` afin que le pull de l'image de base ne
  renvoie pas de 404.
- **RabbitMQ est obligatoire, pas optionnel.** Le `start.sh` intégré de Plane
  valide `AMQP_URL` et se termine avec un code de sortie non nul s'il est
  vide, de sorte que le service additionnel `mq` est toujours ajouté
  dans la liste `Plane_GKE/plane.tf` de `additional_services` — il ne peut pas être
  désactivé via une variable.
- **Le mot de passe RabbitMQ est généré par déploiement** et stocké dans
  Secret Manager (`secret-<prefix>-<app>-rabbitmq-password`) ; l'application (`RABBITMQ_PASSWORD`) et le
  broker (`RABBITMQ_DEFAULT_PASS`) le lisent par référence secrète. L'utilisateur et le
  vhost sont `plane`. Le stockage RabbitMQ est éphémère (pas de
  PVC/NFS attaché) — un redémarrage de pod supprime les jobs en file d'attente,
  et le broker réapplique le mot de passe à chaque démarrage.
- **Redis est hébergé sur une VM NFS par défaut**, exactement comme les autres
  applications RAD qui définissent `enable_redis = true` sans `redis_host` explicite
  — le serveur NFS co-héberge Redis et son IP est injectée via le
  placeholder d'exécution `$(NFS_SERVER_IP)`, résolu par le point d'entrée du
  wrapper.
- **Le stockage d'objets (compatible S3) est un TODO inachevé.** Un bucket GCS
  est créé et `AWS_S3_ENDPOINT_URL` pointe vers `storage.googleapis.com`, mais la couche
  d'interopérabilité S3 de GCS nécessite des clés HMAC qui **ne sont pas
  provisionnées par ce module**. Les téléchargements de fichiers échoueront
  tant que de véritables identifiants compatibles S3 ne seront pas fournis via
  la surcharge `environment_variables` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`). Tout le reste dans Plane (problèmes,
  projets, cycles) fonctionne sans cela.
- **Le nom DNS de RabbitMQ est calculé au moment de la planification, non
  injecté au moment de l'apply.** Contrairement à la variante Cloud Run (qui
  injecte un placeholder `$(PLANE_MQ_HOST)` via le mécanisme de service
  additionnel), `Plane_GKE` surcharge `RABBITMQ_HOST` directement vers le
  nom DNS prévisible in-cluster `<application_name><resource_prefix>-mq.<namespace>.svc.cluster.local` avant qu'il n'atteigne le point
  d'entrée.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail tout-en-un Plane {#a-gke-autopilot--the-plane-all-in-one-workload}

Les pods `plane-aio-community` s'exécutent sur Autopilot, facturés pour le CPU/la
mémoire réellement demandés par le pod. Tous les sous-services de Plane (api,
worker, beat, web, space, admin, live) s'exécutent à l'intérieur de ce
conteneur unique sous supervisord, précédés par Caddy sur le port 80.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Plane pour les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --field-selector=status.phase=Running
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- supervisorctl status
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Plane stocke toutes les données d'application (espaces de travail, projets,
problèmes, cycles, modules, utilisateurs) dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Les pods y accèdent via le sidecar **Cloud SQL Auth
Proxy** ; le point d'entrée du wrapper compose `DATABASE_URL` à partir des
valeurs `DB_*` injectées, en utilisant `sslmode=disable` contre le proxy
de boucle locale. Lors du premier déploiement, le job `db-init` crée le
rôle et la base de données de l'application ; l'étape `migrator` intégrée
de Plane (à l'intérieur du supervisord de l'image AIO) applique ensuite les
migrations de schéma Django au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Redis (hébergé sur VM NFS) {#c-redis-nfs-vm-hosted}

Plane utilise un seul `REDIS_URL` pour le cache Django et le backend de
résultat Celery. Avec `enable_redis = true` et sans `redis_host` explicite, la
fondation résout Redis à l'adresse IP de la VM NFS partagée (service
co-localisé), injectée au moment de l'exécution via `$(NFS_SERVER_IP)` et résolue
par le point d'entrée du wrapper avant de composer `REDIS_URL`.

- **Console :** Compute Engine → Instances de VM (la VM NFS/Redis) ; Filestore
  → Instances.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'REDIS_HOST|REDIS_URL'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

Voir [App_GKE](App_GKE.md) pour la résolution `enable_redis`/`redis_host` et la
gestion de la VM NFS/Redis partagée.

### D. Broker RabbitMQ (service additionnel in-cluster) {#d-rabbitmq-broker-in-cluster-additional-service}

Les processus Celery `worker` et `beat` de Plane nécessitent un
broker AMQP. Ce module déploie RabbitMQ comme un **Déploiement** in-cluster
séparé (via `additional_services`, nom `mq`, image `rabbitmq:3.13-management-alpine`),
accessible uniquement à l'intérieur du cluster (`INGRESS_TRAFFIC_INTERNAL_ONLY`) sur le port
5672. App_GKE nomme le service Kubernetes `<service_name>-mq` ; le point d'entrée du
wrapper compose `AMQP_URL` à partir des identifiants statiques
`plane`/`plane`/vhost-`plane` et de ce nom DNS.

- **Console :** Kubernetes Engine → Workloads / Services & Ingress → filtrez
  pour le suffixe `-mq`.
- **CLI :**
  ```bash
  kubectl get deploy,svc -n "$NAMESPACE" -l app~mq 2>/dev/null || kubectl get deploy,svc -n "$NAMESPACE" | grep -- '-mq'
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-mq --tail=50
  kubectl exec -n "$NAMESPACE" deploy/<service-name>-mq -- rabbitmqctl list_queues
  ```

Voir [App_GKE](App_GKE.md) pour la façon dont `additional_services` provisionne les
déploiements et services sidecar.

### E. Cloud Storage et stockage d'objets (TODO) {#e-cloud-storage--object-storage-todo}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement, et les variables d'environnement `AWS_S3_*` pointent Plane
vers `storage.googleapis.com`. Cependant, la couche d'interopérabilité S3 de GCS
nécessite des clés HMAC que ce module ne provisionne pas, donc **les
téléchargements de fichiers ne fonctionnent pas directement** — voir la
section Vue d'ensemble ci-dessus pour la solution.

- **Console :** Cloud Storage → Buckets → filtrez pour `-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep AWS_S3
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### F. Secret Manager {#f-secret-manager}

Deux secrets Plane sont générés automatiquement et stockés dans Secret
Manager : `SECRET_KEY` (Django, 50 caractères) et `LIVE_SERVER_SECRET_KEY` (auth
serveur live temps réel, 40 caractères). Le mot de passe de la base de données
est géré séparément par la fondation. Sur GKE, les secrets sont projetés dans
les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plane"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### G. Réseau et ingress {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true`), et un domaine
personnalisé avec un certificat géré par Google est activé par défaut
(`enable_custom_domain = true`) une fois que `application_domains` est renseigné.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Plane {#3-plane-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Le job
  `db-init` exécute `db-init.sh` (`postgres:15-alpine`). Il attend que
  Cloud SQL accepte les connexions, crée de manière idempotente le rôle et la
  base de données de l'application (`GRANT` le rôle à `postgres`
  afin que la propriété puisse être définie), accorde les privilèges de
  schéma, puis signale au sidecar Cloud SQL Auth Proxy de s'arrêter
  (`quitquitquit`).
- **La migration de schéma se produit à l'intérieur de l'image AIO à chaque
  démarrage, et non en tant que job séparé.** L'étape `migrator` intégrée
  de Plane s'exécute sous supervisord avant le démarrage de l'API/worker/beat/web
  — il n'y a pas de job Kubernetes `plane-migrate` dédié.
- **La composition de la chaîne de connexion se produit dans le point d'entrée
  du wrapper, et non dans Django lui-même.** Le `start.sh` de l'image AIO
  attend des URL uniques (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`) ; la
  plateforme injecte plutôt des valeurs discrètes `DB_*`/`REDIS_*`/`RABBITMQ_*`,
  donc `scripts/entrypoint.sh` compose les trois URL (gérant le remappage socket-vs-TCP
  de Cloud SQL et les cas de placeholder `$(NFS_SERVER_IP)`/`$(PLANE_MQ_HOST)`) avant
  de `exec`-er `/app/start.sh`.
- **La route d'administration `/god-mode` nécessite un patch Caddyfile.** Le
  basename du routeur SPA d'administration intégré ("god-mode") est
  `/god-mode/` (avec une barre oblique finale) ; le point d'entrée insère de
  manière idempotente une redirection 308 de `/god-mode` (sans barre
  oblique) vers `/app/proxy/Caddyfile` afin que le lien "Get started" dans l'application
  web ne rende pas un spinner de chargement vide.
- **Pas de job de bootstrap d'administration de première exécution séparé.** Le
  flux d'inscription/connexion de Plane crée le premier propriétaire
  d'espace de travail de manière interactive via l'interface utilisateur web
  lors de la première visite ; il n'y a pas d'identifiant d'administrateur
  auto-généré documenté dans la source. {/* TODO: vérifier si Plane AIO livre un compte admin auto-provisionné */}
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent par
  défaut **HTTP** `GET /health` (démarrage : délai initial de 30s, timeout
  de 10s, période de 10s, 30 échecs autorisés — c'est-à-dire jusqu'à 5
  minutes pour le premier démarrage ; vivacité : délai initial de 30s,
  timeout de 10s, période de 30s, 3 échecs), configurées via les variables
  `startup_probe`/`liveness_probe` consommées par `Plane_Common`.
  {/* TODO: vérifier si /health est servi sans authentification sur le proxy Caddy de l'image AIO */}
- **Mise à l'échelle.** `min_instance_count = 1`, `max_instance_count = 3` par défaut — HPA
  peut ajouter des réplicas, mais comme le worker/beat Celery s'exécute
  in-process à l'intérieur de chaque pod, la mise à l'échelle au-delà de 1
  multiplie également les ticks Celery beat planifiés. {/* TODO: vérifier si beat est protégé par un singleton sur les réplicas */}
- **Inspecter le job d'initialisation et les chaînes de connexion composées :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|REDIS_URL|AMQP_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement (UIMeta `group=N`). Seuls les paramètres
spécifiques ou notables pour Plane sont listés ; toutes les autres entrées
sont héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs
par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `plane` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image `makeplane/plane-aio-community` ; l'image upstream n'a pas de tag `latest`, donc la valeur par défaut est épinglée. `latest` est remappé à `stable` au moment du build si fourni. |
| `display_name` / `description` | `Plane - Project Management` / `Plane - Open-source project management tool ...` | Métadonnées d'affichage de la plateforme. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | 2 vCPU — l'image AIO exécute api + worker + beat + web + space + admin + live dans un seul pod. |
| `memory_limit` | `4Gi` | 4 GiB minimum recommandé étant donné le nombre de processus groupés. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Plage HPA ; voir la mise en garde sur la mise à l'échelle de Celery-beat dans la [Section 3](#3-plane-application-behaviour). |
| `container_port` | `80` | Le port d'écoute du proxy inverse Caddy interne — le seul port à exposer. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (boucle locale) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Plane. |
| `workload_type` | `null` → `Deployment` | Déploiement (pas de PVC StatefulSet par défaut). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `additional_services` | `[]` (fourni par l'utilisateur) | Fusionné avec le service RabbitMQ `mq` injecté par le module — l'entrée RabbitMQ elle-même **n'est pas** configurable par l'utilisateur via cette variable ; elle est toujours ajoutée dans `plane.tf`. |
| `initialization_jobs` | `[]` → le job `db-init` intégré | Plane exécute ses propres migrations au démarrage du conteneur ; utilisez cette variable uniquement pour des tâches *additionnelles*. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis lorsque `enable_redis = true` sans `redis_host` explicite — la VM NFS co-héberge Redis. Non utilisé pour le stockage de fichiers d'application Plane. |
| `nfs_mount_path` | `/mnt/nfs` | Pertinent uniquement si vous montez NFS à d'autres fins ; Plane lui-même ne lit/écrit pas ici. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket suffixé par `storage` | Créé automatiquement pour le futur câblage de téléchargement de fichiers ; **actuellement non monté ni authentifié** (voir l'aperçu TODO). |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse n'est monté par défaut. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | fixé à `POSTGRES_15` par `Plane_Common` | Non sélectionnable par l'utilisateur ; `database_type` sur ce module est une variable de fondation miroir inerte. |
| `db_name` | `plane_db` | Nom de la base de données, transmis à `Plane_Common` et à la fondation. |
| `db_user` | `plane_user` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (contrairement à la plupart des modules) ; prend effet une fois que `application_domains` est renseigné. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS/Redis-VM — ne pas supprimer. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la file d'attente de tâches Celery et le cache de Plane ; ne peut pas être désactivé efficacement (le point d'entrée construit toujours un `REDIS_URL`). |
| `redis_host` | `""` | Laissez vide pour utiliser la VM NFS/Redis partagée. |
| `redis_port` | `6379` | Port Redis standard. |

{/* TODO: vérifier — les variables Redis ci-dessus et les variables Cloud Armor
(enable_cloud_armor, admin_ip_ranges, cloud_armor_policy_name, enable_cdn)
portent toutes deux le groupe UIMeta=21 avec des numéros d'ordre qui se
chevauchent dans Plane_GKE/variables.tf ; cela ressemble à une collision de
numérotation de groupe non résolue plutôt qu'à un groupe partagé intentionnel. */}

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
| `service_cluster_ip` | ClusterIP in-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `web_url` | URL de l'interface utilisateur web de Plane — IP externe du LoadBalancer si disponible, sinon l'URL interne du cluster. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités
> autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Présence de RabbitMQ | Ne jamais supprimer le service additionnel `mq` | Critique | Le `start.sh` de Plane refuse de démarrer avec un `AMQP_URL` vide ; toute l'application boucle en cas de crash. |
| `enable_redis` | `true` | Critique | Le backend de cache/file d'attente Celery de Plane n'a pas de connexion sans URL Redis — le worker/beat et le cache échouent. |
| `db_name` / `db_user` | Définir une fois | Critique | Renommer après le premier déploiement pointe Plane vers une base de données inexistante (ou différente) et orpheline toutes les données. |
| `SECRET_KEY` / `LIVE_SERVER_SECRET_KEY` (auto-généré) | Ne jamais changer | Critique | Les modifier après le premier démarrage invalide les sessions signées et les jetons d'authentification du serveur live. |
| Téléchargements de fichiers / `AWS_S3_*` | Fournir de vrais identifiants HMAC compatibles S3 | Élevé | Sans vrais identifiants, les téléchargements (pièces jointes, avatars, images de couverture) échouent silencieusement — le câblage de placeholder n'est pas prêt pour la production. |
| Stockage RabbitMQ | Attacher un PVC/NFS si la durabilité est importante | Élevé | Le service `mq` par défaut utilise un stockage de pod éphémère ; un redémarrage de pod ou une préemption de nœud supprime les jobs Celery en file d'attente. |
| `max_instance_count` | `3` (vérifier le comportement de Celery beat avant d'augmenter davantage) | Moyen | Étant donné que beat s'exécute à l'intérieur de chaque pod, la mise à l'échelle peut dupliquer les ticks de tâche planifiés. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité DB sur GKE ; le désactiver rompt la composition `DATABASE_URL`. |
| `network_tags` | conserver `nfsserver` | Élevé | Le supprimer rompt la connectivité à la VM NFS/Redis, ramenant silencieusement Redis à un hôte inaccessible. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et `WEB_URL`/`DOMAIN_NAME`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Plane
partagée avec la variante Cloud Run (câblage d'image tout-en-un, secrets,
identifiants RabbitMQ, TODO de stockage) est décrite dans
**[Plane_Common](Plane_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Plane sur GKE Autopilot](../labs/Plane_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Plane sur Google Cloud Run](Plane_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Plane Common — Configuration d'application partagée](Plane_Common.md) — la configuration partagée par les deux cibles de déploiement.
