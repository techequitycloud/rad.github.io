---
title: "Rocket.Chat sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Rocket.Chat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/RocketChat_GKE.md @ e69407af sha256:253df0199231 -->

# Rocket.Chat sur GKE Autopilot {#rocketchat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/RocketChat_GKE.png" alt="Rocket.Chat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Rocket.Chat est une plateforme de communication d'équipe open source auto-hébergée
— une alternative à Slack/Teams construite sur Node.js et Meteor, avec des
canaux, des messages directs, des fils de discussion, de la voix/vidéo et une
couche omnicanal/LiveChat. Ce module déploie Rocket.Chat sur **GKE Autopilot**
sur la base [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Rocket.Chat et sur la
façon de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la base App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte Rocket.Chat sur RAD, et comment cela se compare {#what-rocketchat-costs-on-rad-and-how-that-compares}

**L'exécution de Rocket.Chat dans votre propre projet GCP coûte environ 52,86 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure toutes les heures en crédits dans un projet géré par RAD.**
Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~52,86 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~72 crédits/jour, mesuré toutes les heures par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 4 GiB | 46,86 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **52,86 $** |

### Comment cela se compare {#how-it-compares}

- L'exécuter vous-même sur un VPS nu reste l'option la moins chère — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Une plateforme de chat d'équipe est utilisée en continu pendant les heures de travail, de sorte que le coût d'exécution ci-dessus reflète un trafic quotidien réel plutôt qu'une utilisation occasionnelle — c'est le chiffre à surveiller, pas les frais de module.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement
le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement
à la suppression d'un module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource
de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu.
Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources
déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour lequel RAD ne
gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la création
d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des
utilisations d'étude/démo). Google indique que la plupart des services fonctionnent à
nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours.
Si vous avez personnalisé l'application et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Rocket.Chat purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 110 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Rocket.Chat reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 7 jours ou plus. Il n'y a pas de base de données ici à maintenir en fonctionnement après sa suppression — la majeure partie du coût d'exécution est le pod GKE lui-même, plus une part des frais de gestion du cluster si d'autres applications GKE s'exécutent dans le même projet, donc la suppression de cette application récupère presque la totalité du chiffre ci-dessus.

**Conserver les données en premier :** les sauvegardes nocturnes sont stockées dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc copiez la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Rocket.Chat s'exécute en tant que **StatefulSet** Node.js/Meteor avec son
datastore intégré dans le même pod. Le déploiement connecte un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js/Meteor, 1 vCPU / 2 GiB par défaut ; un seul réplica StatefulSet |
| Datastore | Ensemble de réplicas MongoDB 6.0 intégré | Intégré à l'image — pas de Cloud SQL. Ensemble de réplicas à nœud unique (`rs0`) sur `127.0.0.1` |
| Persistance | PVC Persistent Disk (stockage par blocs) | Le répertoire de données MongoDB `/data/db` se trouve sur un PVC `ReadWriteOnce` — requis pour WiredTiger |
| Secrets | Secret Manager | Jeton d'API optionnel (`enable_api_key`) |
| Ingress | LoadBalancer / Cloud Load Balancing | Externe par défaut (application de chat publique) ; domaine personnalisé optionnel + certificat géré + Gateway |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MongoDB est intégré, non géré.** La réactivité en temps réel de Meteor suit
  l'oplog de MongoDB, que seul un **ensemble de réplicas** fournit. Aucun
  datastore géré ici n'offre un ensemble de réplicas MongoDB, donc le module
  regroupe un ensemble de réplicas à nœud unique (`rs0`) dans l'image du pod.
  Il n'y a pas d'instance Cloud SQL.
- **MongoDB 6.0 du dépôt Debian bullseye.** L'image de base `rocketchat/rocket.chat` est Debian
  **bullseye** (glibc 2.31) ; le Dockerfile installe MongoDB 6.0 depuis le
  dépôt APT de bullseye car le paquet bookworm/7.0 nécessite glibc ≥ 2.34.
- **`stateful_pvc_enabled = true` est requis.** Le moteur de stockage WiredTiger de MongoDB nécessite
  un véritable système de fichiers par blocs — un montage `gcsfuse` le corrompt.
  Le déploiement GKE active par défaut un PVC StatefulSet à `/data/db` (correspondant
  à `MONGO_DBPATH`). La définition de `stateful_pvc_enabled = true` résout automatiquement `workload_type` en `StatefulSet`.
- **Un seul réplica.** `min_instance_count = 1` et `max_instance_count = 1`. Le PVC est `ReadWriteOnce` et le MongoDB
  intégré est un écrivain unique ; un deuxième réplica ne peut pas attacher le
  disque.
- **Port 3000.** Rocket.Chat écoute sur le port 3000 ; le point d'entrée définit
  `PORT=3000`.
- **Santé sur `/api/info`.** Les vérifications de démarrage, de vivacité et de
  disponibilité ciblent `/api/info`, qui renvoie 200 seulement une fois que le
  serveur et son ensemble de réplicas sont prêts.
- **LoadBalancer par défaut.** Rocket.Chat est une application de chat publique,
  donc le Service obtient une IP externe prête à l'emploi ; un domaine
  personnalisé + Gateway (et IAP optionnel) est disponible pour un nom d'hôte
  stable et un certificat géré.
- **La première exécution est un assistant de configuration en 4 étapes.** Aucun
  administrateur n'est pré-initialisé — la première visite du navigateur
  permet de créer le compte administrateur et l'organisation.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Rocket.Chat {#a-gke-autopilot--the-rocketchat-workload}

Rocket.Chat s'exécute en tant que pod StatefulSet planifié sur Autopilot, qui
facture le CPU/la mémoire demandés par le pod. Étant donné que l'ensemble de
données MongoDB réside sur un PVC `ReadWriteOnce` et que l'application est un écrivain
unique, la charge de travail est un réplica unique.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez le
  StatefulSet Rocket.Chat pour voir le pod, le PVC et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,pvc,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, des StatefulSets et des PVC.

### B. MongoDB intégré (pas de Cloud SQL) {#b-embedded-mongodb-no-cloud-sql}

Il n'y a **pas d'instance Cloud SQL** — `database_type = "NONE"`. MongoDB s'exécute à
l'intérieur du pod Rocket.Chat en tant qu'ensemble de réplicas à nœud unique
(`rs0`) sur `127.0.0.1:27017`, avec ses données sur le PVC StatefulSet à `/data/db`. Le
point d'entrée démarre `mongod`, initialise l'ensemble de réplicas au premier
démarrage, attend `PRIMARY`, puis lance Rocket.Chat.

```bash
# Confirm the embedded MongoDB reached PRIMARY on boot:
kubectl logs -n "$NAMESPACE" statefulset/<service-name> | grep -i "replica set rs0 is PRIMARY"
# Open a mongosh shell inside the pod (for maintenance / mongodump):
kubectl exec -it -n "$NAMESPACE" <pod> -- mongosh "mongodb://127.0.0.1:27017/rocketchat?replicaSet=rs0"
```

### C. PVC Persistent Disk (données MongoDB) {#c-persistent-disk-pvc-mongodb-data}

L'ensemble de données MongoDB réside sur un PVC StatefulSet (`standard-rwo` PD équilibré
par défaut) monté à `/data/db`. Ce volume de blocs est ce qui rend WiredTiger sûr
— ne le remplacez **pas** par un montage `gcsfuse`.

- **Console :** Kubernetes Engine → Stockage → Revendications de volume persistant ;
  Compute Engine → Disques.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud compute disks list --project "$PROJECT" --filter="name~pvc"
  ```

Voir [App_GKE](App_GKE.md) pour les StorageClasses, le dimensionnement des PVC et le CMEK.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné pour les sauvegardes et le
stockage des fichiers téléchargés, en parallèle du PVC. Le compte de service de
la charge de travail se voit accorder l'accès.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

### E. Secret Manager {#e-secret-manager}

Lorsque `enable_api_key = true`, un jeton d'API aléatoire est généré et stocké dans Secret
Manager pour les intégrations externes, matérialisé dans l'espace de noms via
le pilote CSI Secret Store. Aucun autre secret d'application n'est créé ici
— Rocket.Chat crée et stocke ses propres clés dans MongoDB lors de la
configuration initiale.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  kubectl get secrets -n "$NAMESPACE"
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est un service **LoadBalancer** (IP externe),
accessible depuis un navigateur sans configuration supplémentaire. Pour un nom
d'hôte stable et un TLS géré, activez un domaine personnalisé avec un
certificat géré par Google (API Gateway) et, éventuellement, IAP. Une IP
statique est réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get gateway,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Lorsque vous attachez un domaine personnalisé, définissez `ROOT_URL` sur ce nom d'hôte.
Voir [App_GKE](App_GKE.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard et d'erreur du pod (Rocket.Chat et `mongod` intégré) sont
acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud
Monitoring. Une vérification de disponibilité optionnelle cible `/api/info`.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Rocket.Chat {#3-rocketchat-application-behaviour}

- **Amorçage de l'ensemble de réplicas intégré.** À chaque démarrage du pod, le
  point d'entrée démarre `mongod --replSet rs0`, initialise l'ensemble de réplicas une fois
  (idempotent), attend que le nœud soit `PRIMARY`, puis exporte `MONGO_URL` / `MONGO_OPLOG_URL`
  et démarre Rocket.Chat. L'URL de l'oplog permet les mises à jour en temps
  réel de Meteor.
- **Assistant de configuration de première exécution.** La première visite du
  navigateur ouvre un assistant en 4 étapes : (1) **Informations
  administrateur** — créer le compte administrateur (nom, nom d'utilisateur,
  e-mail, mot de passe) ; (2) **Informations sur l'organisation** — nom, type,
  secteur d'activité, taille, pays ; (3) **Enregistrer le serveur** —
  enregistrer auprès de Rocket.Chat Cloud ou conserver le serveur autonome ;
  (4) **Terminer**. Aucun administrateur n'est pré-initialisé.
- **Persistance des données.** Tout l'état (messages, utilisateurs, paramètres)
  réside dans le MongoDB intégré sur le PVC à `/data/db`. La suppression du PVC
  supprime l'espace de travail.
- **Correction de `ROOT_URL`.** Le point d'entrée définit par défaut `ROOT_URL` sur
  l'URL de service calculée. Si vous servez Rocket.Chat sur un domaine
  personnalisé, définissez `ROOT_URL` (via `environment_variables`) sur cette URL, sinon les liens
  et les redirections OAuth pointeront vers le mauvais hôte.
- **Les mises à jour recréent le pod unique.** Avec un réplica StatefulSet sur
  un PVC `RWO`, un déploiement termine l'ancien pod avant que le nouveau ne
  rattache le disque — un bref temps d'arrêt est attendu lors des mises à
  niveau de version.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/info`.
  Prévoyez quelques minutes au premier démarrage pour l'élection de l'ensemble
  de réplicas et les migrations initiales de Rocket.Chat.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Rocket.Chat sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. Utilisez `gke` pour exécuter en parallèle une variante Cloud Run. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `rocketchat` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `RocketChat Vector Database` | Nom lisible par l'homme affiché dans la Console (la valeur par défaut porte une étiquette héritée ; remplacez-la par quelque chose comme `Rocket.Chat Team Chat`). |
| `application_version` | `latest` | Tag d'image Rocket.Chat ; `latest` épingle le build à `6.12.1`. Épinglez à une version spécifique en production. |
| `enable_api_key` | `false` | Générer un jeton d'API aléatoire dans Secret Manager pour les intégrations externes. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `4Gi` | Mémoire par pod ; Rocket.Chat + MongoDB intégré la partagent. |
| `min_instance_count` | `1` | Maintenir à 1 — GKE exige min ≥ 1 et le MongoDB intégré est un écrivain unique. |
| `max_instance_count` | `1` | **Maintenir à 1** — le PVC `RWO` et le MongoDB à écrivain unique interdisent un deuxième réplica. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Non applicable — Rocket.Chat n'a pas de base de données SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Rocket.Chat dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `MONGO_URL`/`MONGO_OPLOG_URL`/`MONGO_DBPATH` — le point d'entrée les possède. Utilisez `OVERWRITE_SETTING_*` pour initialiser les paramètres d'administration ; définissez `ROOT_URL` pour un domaine personnalisé. |
| `secret_environment_variables` | `{}` | Carte des variables d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé ; externe par défaut puisque Rocket.Chat est une application de chat publique. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (requis). |
| `session_affinity` | `None` | Définissez `ClientIP` pour un routage WebSocket stable derrière un équilibreur de charge. |
| `termination_grace_period_seconds` | `60` | Secondes après SIGTERM avant SIGKILL — permet à MongoDB de vider et de s'arrêter proprement. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Définissez `true` (requis).** Le moteur WiredTiger de MongoDB nécessite un stockage par blocs — `gcsfuse` le corrompt. Sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; taille pour contenir l'ensemble de données MongoDB. Ne peut pas être diminuée. |
| `stateful_pvc_mount_path` | `/data/db` | **Doit être égal à `MONGO_DBPATH`** pour que le PVC contienne l'ensemble de données MongoDB. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (PD équilibré) ou `premium-rwo` (IOPS plus élevées pour MongoDB). |
| `stateful_fs_group` | `3000` | GID fsGroup pour l'accès en écriture du PVC (valeur par défaut du graphique Helm Rocket.Chat). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Unités binaires uniquement** (`4Gi`, `8192Mi`) — les entiers bruts sont des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité lors des mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles lors de perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/info` 60s de délai, 40 échecs | Sonde de démarrage. Prévoir quelques minutes au premier démarrage. |
| `liveness_probe` | HTTP `/api/info` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle contre `/api/info`. |
| `alert_policies` | `[]` | Politiques d'alerte métriques optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation par défaut — le MongoDB intégré est amorcé par le point d'entrée. |
| `cron_jobs` | `[]` | CronJobs Kubernetes (par exemple, sauvegardes `mongodump`). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Rocket.Chat. |

### Groupe 12 — CI/CD et autorisation binaire {#group-12--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS désactivé par défaut ; MongoDB utilise le PVC de blocs. Activer uniquement pour le partage de fichiers téléchargés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket de sauvegarde/fichier. |
| `gcs_volumes` | `[]` | Montages GCS Fuse — **pas** pour les données MongoDB (utiliser le PVC). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un dump MongoDB lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Gateway pour les noms d'hôtes personnalisés + certificat géré. Définir `ROOT_URL` pour correspondre. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Rocket.Chat (nécessite `enable_custom_domain`). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `service_external_ip` | IP externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre l'interface web de Rocket.Chat. |
| `rocketchat_api_key_secret_id` | ID du secret Secret Manager pour le jeton d'API (vide lorsque `enable_api_key = false`). |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les
> combinaisons* au moment de la planification — `workload_type = "Deployment"` avec `stateful_pvc_enabled = true`, IAP sans
> identités autorisées, unités de quota non binaires, un `backup_retention_days` hors de portée. Une
> configuration invalide fait échouer la **planification** avec une erreur claire et
> nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Sur `gcsfuse` (la valeur par défaut si non définie), l'ensemble de données WiredTiger de MongoDB est corrompu — l'espace de travail est irrécupérable. |
| `stateful_pvc_mount_path` | `/data/db` | Critique | Tout autre chemin signifie que le PVC ne contient pas l'ensemble de données MongoDB ; les données résident sur le système de fichiers éphémère du pod et sont perdues au redémarrage. |
| `max_instance_count` | `1` | Critique | Le PVC `RWO` et le MongoDB à écrivain unique ne peuvent pas prendre en charge un deuxième réplica ; le pod de surtension ne parvient pas à attacher le disque et corrompt l'état s'il est forcé. |
| PVC / `/data/db` (auto) | Ne jamais supprimer | Critique | La suppression du PVC supprime l'intégralité de l'espace de travail. |
| `workload_type` | laisser `null` | Élevé | La définition de `Deployment` avec `stateful_pvc_enabled = true` échoue au moment de la planification ; laissez-le non défini pour qu'il se résolve automatiquement en StatefulSet. |
| `ROOT_URL` (domaine personnalisé) | Correspondre au nom d'hôte servi | Élevé | Un `ROOT_URL` non concordant rompt les liens d'invitation, les URL de fichiers et les rappels OAuth. |
| `memory_limit` | `4Gi` (par défaut) | Élevé | Rocket.Chat plus MongoDB dans un seul pod OOM en dessous de ~2 GiB sous une charge réelle. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `stateful_pvc_storage_class` | `standard-rwo` (ou `premium-rwo`) | Moyen | `premium-rwo` donne à MongoDB plus d'IOPS pour les espaces de travail occupés à un coût plus élevé. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser le pod pendant la maintenance sans protection. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Rocket.Chat partagée avec la variante Cloud
Run est décrite dans **[RocketChat_Common](RocketChat_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Rocket.Chat sur GKE Autopilot](../labs/RocketChat_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Rocket.Chat Common — Configuration d'application partagée](RocketChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
