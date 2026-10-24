---
title: "Miniflux sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Miniflux sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Miniflux_GKE.md @ 1665a43e sha256:f244b0fe4b12 -->

# Miniflux sur GKE Autopilot {#miniflux-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Miniflux_GKE.png" alt="Miniflux sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un
simple binaire Go statique qui stocke tout son état dans PostgreSQL. Ce module
déploie Miniflux sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Miniflux et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Miniflux sur RAD, et comment cela se compare {#what-miniflux-costs-on-rad-and-how-that-compares}

**L'exécution de Miniflux dans votre propre projet GCP coûte environ 136,37 $/mois en frais Google Cloud ; les frais de module de RAD sont de 175 crédits uniques (ou 157,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure toutes les heures en crédits dans un projet géré par RAD.**
Ou consultez le guide Cloud Run pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~136,37 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~105 crédits/jour, mesuré toutes les heures par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **136,37 $** |

### Comment cela se compare {#how-it-compares}

- L'instance hébergée officielle du projet coûte **15 $/an** (environ 1,25 $/mois) (source : https://miniflux.app/#pricing), gérée par le projet lui-même sans infrastructure à opérer — la comparaison importante ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous — mais le prix de RAD n'est jamais censé battre un VPS, seulement remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit d'un lecteur de flux mono-utilisateur, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD commence par dissocier sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne démantèle pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà dissociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Miniflux purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 175 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Miniflux resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 4 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://miniflux.app/#pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Miniflux s'exécute comme une charge de travail web Go à conteneur unique. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique dans un déploiement, mis à l'échelle horizontalement entre `min`/`max` réplicas |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Miniflux stocke **tout** l'état ici ; pas de MySQL/autre moteur |
| Stockage d'objets | Cloud Storage (aucun) | Miniflux n'a pas besoin de bucket ; un montage NFS Filestore optionnel est disponible mais inutilisé par défaut |
| Cache et file d'attente | Aucun | Miniflux n'a pas de dépendance Redis et pas de worker séparé |
| Secrets | Secret Manager | `ADMIN_PASSWORD` auto-généré (propriétaire initial) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec affinité de session `ClientIP`, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  interrompt le démarrage.
- **Le sondeur de flux s'exécute en interne.** Miniflux n'a pas de worker
  séparé — le même pod sert l'interface utilisateur et rafraîchit les flux sur
  `POLLING_FREQUENCY`. Gardez au moins un réplica en cours d'exécution pour que le
  sondage continue (GKE ne met pas à l'échelle à zéro).
- **Le propriétaire initial est amorcé, non auto-enregistré.** `CREATE_ADMIN = 1`
  amorce le compte `admin` à partir du secret `ADMIN_PASSWORD` au premier
  démarrage ; l'inscription en libre-service ouverte reste désactivée.
  Récupérez le mot de passe de Secret Manager pour vous connecter.
- **Les migrations de schéma s'exécutent au démarrage** (`RUN_MIGRATIONS = 1`) — il n'y
  a pas de job de migration séparé, donc la mise à niveau de la version
  applique automatiquement les modifications de schéma.
- **Pas de Redis.** `enable_redis = false` — Miniflux conserve chaque flux, entrée et
  session dans PostgreSQL. Laissez-le désactivé. Comme il n'y a pas de file
  d'attente partagée, l'exécution de plusieurs réplicas partage simplement la
  charge de requêtes (chacun sonde toujours indépendamment).
- **L'affinité de session est `ClientIP`.** Maintient un client épinglé à un
  pod pour une session d'interface utilisateur cohérente.
- **`DATABASE_URL` est composé à l'exécution** par le point d'entrée du
  conteneur (forme mot-clé/valeur libpq), se ramifiant sur la boucle locale du
  proxy d'authentification GKE (`127.0.0.1`, `sslmode=disable`) afin que la même
  image fonctionne sur Cloud Run et GKE.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Miniflux {#a-gke-autopilot--the-miniflux-workload}

Les pods Miniflux s'exécutent en tant que déploiement sur Autopilot, écoutant
sur le port **8080**, facturés pour le CPU/la mémoire qu'ils demandent.
L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Miniflux pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Miniflux stocke **toutes** les données de l'application (flux, entrées,
utilisateurs, sessions, catégories) dans une instance Cloud SQL pour
PostgreSQL 15 gérée. Les pods y accèdent en privé via le sidecar **Cloud SQL
Auth Proxy** sur la boucle locale (`127.0.0.1`) ; aucune IP publique n'est
exposée. Lors du premier déploiement, le job `db-init` crée la base de données
et le rôle `miniflux` et installe l'extension `hstore` appartenant au rôle de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe sont affichés dans les [Sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatisées et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage / NFS {#c-cloud-storage--nfs}

Miniflux n'a **pas** besoin de stockage d'objets — il conserve tout son état
dans PostgreSQL, donc aucun bucket de données n'est provisionné par la couche
d'application. Le montage Cloud Filestore optionnel (`enable_nfs`, à `/opt/miniflux/storage`)
est désactivé par défaut, car Miniflux n'y écrit jamais.

- **Console :** Filestore → Instances (si NFS est activé) ; Cloud Storage →
  Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : `ADMIN_PASSWORD` — le mot de passe du
propriétaire initial amorcé dans Miniflux au premier démarrage. Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing avec affinité de session `ClientIP`. Un domaine personnalisé avec
un certificat géré par Google peut être activé, et une IP statique peut être
réservée afin que l'adresse survive aux redéploiements. Lorsqu'un domaine
personnalisé est utilisé, définissez `BASE_URL` afin que Miniflux émette des
liens absolus corrects.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte optionnels sont disponibles. Le point
d'entrée enregistre son mode de connexion `DATABASE_URL` au démarrage — utile pour
diagnostiquer la connectivité de la base de données.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Miniflux {#3-miniflux-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données et le
  rôle `miniflux`, accorde les privilèges, réattribue le schéma `public` et
  installe l'extension `hstore` **appartenant au rôle de l'application** (afin
  que la migration Miniflux `v119`, qui supprime `hstore`, réussisse). Le job
  publie ensuite sur le `/quitquitquit` du sidecar proxy afin que le pod du job se
  termine ; il peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée définit `RUN_MIGRATIONS=1`,
  de sorte que Miniflux applique ses propres migrations de schéma à chaque
  démarrage — pas d'étape de migration séparée. Prévoyez un temps
  supplémentaire au premier démarrage pour la construction initiale du schéma.
- **Le propriétaire initial est amorcé.** `CREATE_ADMIN=1` amorce le compte
  `admin` (`ADMIN_USERNAME`) à partir du secret `ADMIN_PASSWORD`. C'est idempotent — les
  démarrages ultérieurs enregistrent "l'utilisateur existe déjà". Récupérez le
  mot de passe pour vous connecter :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité de ce module
  pointent par défaut vers HTTP `/` (la page de connexion, un `200 OK`
  non authentifié). Miniflux sert également un `200 OK` non authentifié à
  `/healthcheck` si vous préférez un chemin de sonde dédié. Ne pointez pas les
  sondes vers des pages authentifiées.
- **Le sondeur de flux est interne.** Les flux se rafraîchissent sur `POLLING_FREQUENCY`
  à l'intérieur de chaque pod. Gardez `min_instance_count >= 1` pour que le sondage
  s'exécute ; les réplicas supplémentaires sondent chacun indépendamment (il
  n'y a pas de file d'attente partagée pour les coordonner).
- **`BASE_URL` pilote les liens absolus.** Il utilise par défaut l'URL de
  service interne injectée ; définissez-le explicitement (via `environment_variables`) sur
  l'URL externe du LoadBalancer ou du domaine personnalisé une fois l'adresse
  connue.
- **Inspectez le job et les pods db-init :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Miniflux sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `miniflux` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image Miniflux ; épingler à une version (par exemple `2.2.15`) en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; maintenez à 1 pour que le sondeur de flux continue de fonctionner. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. Miniflux n'a pas de file d'attente partagée — les pods supplémentaires partagent uniquement la charge de requêtes. |
| `container_port` | `8080` | Miniflux écoute sur le port 8080. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité (requis sur GKE). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Miniflux dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `BASE_URL`, `POLLING_FREQUENCY`). Ne pas définir `DATABASE_URL` (composé à l'exécution). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout automatiquement en un déploiement sans état (Miniflux stocke tout l'état dans PostgreSQL — pas besoin de StatefulSet). |
| `session_affinity` | `ClientIP` | Épingler un client à un pod pour une session d'interface utilisateur cohérente. |
| `container_protocol` | `http1` | HTTP/1.1 standard. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser désactivé — Miniflux conserve tout l'état dans PostgreSQL, donc aucun PVC par pod n'est requis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s de délai, 15s de période, 30 échecs | Sonde de démarrage. Fenêtre généreuse pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, 60s de délai, 30s de période | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel ; activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (rôle/base de données/`hstore`). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés optionnels. |
| `additional_services` | `[]` | Sidecar ou services d'aide déployés avec Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Miniflux nécessite PostgreSQL. |
| `application_database_name` | `miniflux` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `miniflux` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne un montage NFS Filestore à `/opt/miniflux/storage`. Laisser désactivé — Miniflux stocke l'état dans PostgreSQL et n'écrit jamais sur le montage. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Chemin de montage à l'intérieur du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste si vous en avez besoin de plus. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux n'utilise pas Redis — laisser désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Inutilisé par Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_uri`, `backup_format` — sauvegarde Cloud SQL automatisée et restauration au
déploiement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré (une passerelle avec une IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôtes à servir (définir `BASE_URL` pour correspondre). |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Proxy sensible à l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Miniflux (bloque les clients de jetons Fever/Reader-API). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn` —
attacher une politique WAF / CDN au backend Ingress. Voir [App_GKE](App_GKE.md).

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` — voir
[App_GKE](App_GKE.md).

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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Miniflux. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (`miniflux`). |
| `database_user` | Utilisateur de la base de données de l'application (`miniflux`). |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut). |
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
> valeurs *et les combinaisons* au moment de la planification — une charge de
> travail `Deployment` avec `stateful_pvc_enabled = true`, IAP sans identités autorisées, un
> runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne
> correspond pas à une extension activée, des valeurs `quota_memory_*` entières
> brutes. Une configuration invalide échoue à la **planification** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Miniflux ne prend en charge que PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `application_database_name` / `application_database_user` | Définir une fois (`miniflux`) | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les flux et entrées. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide échoue au job d'importation. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer de Secret Manager | Élevé | C'est la seule credential de propriétaire amorcée au premier démarrage ; sans elle, vous ne pouvez pas vous connecter tant que vous ne l'avez pas réinitialisée dans la base de données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE ; le désactiver interrompt la connexion à la base de données. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; maintenir 1 garantit que le sondeur de flux interne continue de se rafraîchir. |
| `enable_redis` | `false` | Moyen | Redis est inutilisé ; l'activer gaspille des ressources et ne change rien. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les requêtes d'un client sautent de pod en pod, perturbant la session de l'interface utilisateur. |
| `startup_probe.path` | `/healthcheck` | Élevé | Pointer la sonde vers une page authentifiée renvoie 401/403 et le pod ne devient jamais Prêt. |
| `enable_iap` | désactivé sauf si l'interface utilisateur doit être protégée | Moyen | IAP place la connexion Google devant l'interface utilisateur/API, bloquant les clients de jetons Fever/Reader-API. |
| `BASE_URL` (env) | URL du LoadBalancer externe / du domaine | Moyen | Une URL de base obsolète/incorrecte génère des liens absolus et des URL d'images de proxy de flux cassés. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Miniflux
partagée avec la variante Cloud Run est décrite dans
**[Miniflux_Common](Miniflux_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Miniflux sur GKE Autopilot](../labs/Miniflux_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Miniflux sur Google Cloud Run](Miniflux_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Miniflux Common — Configuration d'application partagée](Miniflux_Common.md) — la configuration partagée par les deux cibles de déploiement.
