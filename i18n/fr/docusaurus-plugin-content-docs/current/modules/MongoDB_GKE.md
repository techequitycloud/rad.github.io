---
title: "MongoDB sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de MongoDB sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/MongoDB_GKE.md @ e69407af sha256:4ab75ab7b965 -->

# MongoDB sur GKE Autopilot {#mongodb-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MongoDB_GKE.png" alt="MongoDB sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

MongoDB est la base de données de documents NoSQL la plus populaire au monde, utilisée par des
organisations de toutes tailles pour la gestion de contenu, les pipelines de données IoT, les
backends mobiles et les magasins de fonctionnalités AI/ML où les schémas relationnels sont trop
rigides. Ce module déploie MongoDB sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que MongoDB utilise et sur la façon de les explorer
et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez-vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte MongoDB sur RAD, et comment cela se compare {#what-mongodb-costs-on-rad-and-how-that-compares}

**L'exécution de MongoDB dans votre propre projet GCP coûte environ 96,70 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure toutes les heures en crédits dans un projet géré par RAD.**
Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~96,70 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~76 crédits/jour, mesuré toutes les heures par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 GiB | 39,68 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **96,70 $** |

### Comment cela se compare {#how-it-compares}

- Le service géré de MongoDB, Atlas, a un palier M0 partagé gratuit et son palier dédié le moins cher (M10, 2 vCPU/2 Go) coûte **environ 57 $/mois** (source : https://www.mongodb.com/pricing), géré par le projet lui-même sans infrastructure à opérer — la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu est toujours l'option la moins chère — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit de la couche de base de données de documents d'une application, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD délie
d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la
suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google
de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
Update sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
individuellement détruit, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais
de module. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la
facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime
définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre
solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du
projet, et ce bucket a la suppression logique de Cloud Storage explicitement désactivée, il est
donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même
est récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet)
avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours
ci-dessus), l'alternative est de supprimer MongoDB purement et simplement et de le redéployer plus
tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6
crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si MongoDB restait inutilisé assez longtemps
pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par
rapport au total du projet ci-dessus, cela représente environ 2 jours ou plus. La majeure partie
du coût d'exécution ici est généralement la base de données ; elle ne s'arrête que si rien d'autre
dans le projet ne l'utilise, donc la suppression de cette application alors que quelque chose
d'autre partage le projet n'économise que la partie calcul de cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du
déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer
si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque
  participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24
  heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance
  toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la
  session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le
  client. Si le portefeuille est faible, la facturation est suspendue et les données sont
  conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
  ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://www.mongodb.com/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

MongoDB s'exécute en tant que StatefulSet sur GKE Autopilot. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot (StatefulSet) | 1 vCPU / 2 GiB par défaut, mode nœud unique |
| Stockage persistant | Persistent Disk (SSD PVC) | `standard-rwo` StorageClass, 20 GiB par défaut, monté à `/data/db` |
| Secrets | Secret Manager | Mot de passe root MongoDB auto-généré |
| Images de conteneurs | Artifact Registry | Image officielle `mongo` mise en miroir dans le registre du projet |
| Réseau | VPC / GKE Service | `ClusterIP` par défaut pour l'accès interne au cluster ; passer à `LoadBalancer` uniquement si un accès externe au protocole filaire brut est requis |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** MongoDB est son propre moteur de base de données ; Cloud SQL n'est pas
  provisionné et `enable_cloudsql_volume` est codé en dur à `false`.
- **Le PVC SSD est essentiel.** Sans PVC StatefulSet, toutes les données sont perdues à chaque
  redémarrage de pod. `stateful_pvc_enabled = true` sélectionne automatiquement un StatefulSet.
- **Mode nœud unique uniquement.** `min_instance_count` et `max_instance_count` sont
  tous deux fixés à 1. Les réplicas MongoDB nécessitent une clé d'authentification
  supplémentaire et une configuration `rs.initiate()` qui dépasse le cadre de ce module.
- **Le mot de passe root est auto-généré.** `MONGO_INITDB_ROOT_PASSWORD` est généré
  et stocké dans Secret Manager lors du premier déploiement ; vous ne le définissez jamais en
  texte clair.
- **Sondes TCP sur le port 27017.** MongoDB utilise son propre protocole filaire binaire, pas
  HTTP — les sondes HTTP échouent toujours.
- **fsGroup 999 est codé en dur.** L'image officielle MongoDB exécute `mongod` en tant que
  UID/GID 999 ; Kubernetes chown le montage PVC à ce GID automatiquement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet MongoDB {#a-gke-autopilot--the-mongodb-statefulset}

MongoDB s'exécute en tant que StatefulSet à pod unique sur Autopilot, qui provisionne les nœuds
à la demande et facture le CPU et la mémoire que le pod demande réellement. Autopilot doit
provisionner un nœud, attacher le PVC et extraire l'image avant que `mongod` ne démarre
— la sonde de démarrage permet jusqu'à ~8 minutes pour s'adapter à cela.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet MongoDB pour
  l'état du pod, les événements et l'utilisation des ressources. Kubernetes Engine → Services & Ingress
  affiche l'IP ClusterIP ou l'IP externe du LoadBalancer.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<statefulset-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>   # events and probe status
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le StatefulSet
type de charge de travail sont gérés.

### B. Persistent Disk — PVC SSD {#b-persistent-disk--ssd-pvc}

Les données MongoDB résident sur un **Persistent Disk SSD PVC** (`standard-rwo` StorageClass)
monté à `/data/db` à l'intérieur du conteneur. Le PVC est provisionné automatiquement
par GKE lorsque le StatefulSet est créé et persiste indépendamment des redémarrages de pod,
des mises à jour continues et des évictions de nœuds.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims pour voir le PVC
  et son volume lié. Compute Engine → Disks pour voir le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>   # capacity, access mode, status
  # Check disk usage inside the running pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /data/db
  ```

La taille du PVC est définie au moment du déploiement par `stateful_pvc_size` (par défaut `20Gi`).
**La taille du PVC ne peut pas être diminuée après la création.** Provisionnez au moins 2 à 3 fois
le volume de données initial attendu pour éviter le crash `No space left on device`.

### C. Secret Manager — mot de passe root {#c-secret-manager--root-password}

Le mot de passe root de MongoDB (`MONGO_INITDB_ROOT_PASSWORD`) est auto-généré lors
du premier déploiement et stocké en tant que secret Secret Manager. Il est injecté dans le
pod via le pilote CSI Secret Store et n'apparaît jamais en texte clair.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mongo-root-password"
  gcloud secrets versions access latest \
    --secret=<secret-name> --project "$PROJECT"
  ```

Pour récupérer le mot de passe root pour une connexion `mongosh` :
```bash
ROOT_PASS=$(gcloud secrets versions access latest \
  --secret=<resource-prefix>-mongo-root-password --project "$PROJECT")
kubectl exec -n "$NAMESPACE" <pod-name> -- \
  mongosh --username admin --password "$ROOT_PASS" --authenticationDatabase admin
```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Artifact Registry — image de conteneur {#d-artifact-registry--container-image}

L'image officielle `mongo` est mise en miroir dans l'Artifact Registry du projet avant
le déploiement afin que les pods ne tirent jamais directement de Docker Hub. L'URI de l'image mise
en miroir est rapportée dans la sortie `container_image`.

- **Console :** Artifact Registry → sélectionnez le dépôt.
- **CLI :**
  ```bash
  gcloud artifacts docker images list \
    <region>-docker.pkg.dev/$PROJECT/<registry-repo> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, le service Kubernetes MongoDB est **ClusterIP** — MongoDB est un
backend de base de données destiné à être consommé par d'autres charges de travail
intra-cluster (par exemple RocketChat), et ClusterIP fournit déjà un accès
inter-espaces de noms au sein du cluster via DNS, donc aucun LoadBalancer n'est
nécessaire. Passez à `LoadBalancer` uniquement si un accès externe au protocole
filaire MongoDB brut (port 27017) est réellement requis.

- **Console :** Kubernetes Engine → Services & Ingress ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Get the LoadBalancer external IP:
  kubectl get svc -n "$NAMESPACE" <service-name> \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```

La sortie `mongodb_endpoint` fournit l'URI de connexion prête à l'emploi
(`mongodb://<ip>:27017` pour LoadBalancer ou l'URI DNS intra-cluster pour ClusterIP).

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, les IP statiques et
les détails de Cloud CDN.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods (y compris les journaux de démarrage et de requête de `mongod`)
sont acheminées vers Cloud Logging. Les métriques GKE et Persistent Disk sont acheminées vers Cloud
Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application MongoDB {#3-mongodb-application-behaviour}

- **Mode autonome uniquement.** Ce module déploie une seule instance `mongod`.
  Les réplicas MongoDB (flux de modifications, transactions, réplication d'oplog) nécessitent
  des fichiers de clé d'authentification et une configuration `rs.initiate()` qui dépassent le cadre
  de ce module. `max_instance_count` est forcé à 1.
- **Initialisation au premier démarrage.** Lors du tout premier démarrage avec un PVC frais,
  MongoDB crée l'utilisateur root (`MONGO_INITDB_ROOT_USERNAME`, par défaut `admin`)
  et la base de données initiale (`MONGO_INITDB_DATABASE`, par défaut `admin`). Ces
  valeurs sont **immuables après l'écriture du PVC** — les modifier après le premier déploiement
  n'a aucun effet (le script d'initialisation ne s'exécute qu'une seule fois par répertoire de
  données).
- **Dimensionnement du cache WiredTiger.** Le moteur de stockage WiredTiger de MongoDB définit par
  défaut son cache à environ `(memory_limit − 1 GiB) × 0.5`. Avec la limite par défaut `2Gi`,
  le cache est d'environ 500 Mio, ce qui est suffisant pour le développement. Mettez à l'échelle
  le `memory_limit` à `4Gi`–`8Gi` pour les charges de travail de documents en production.
- **Tolérance de la sonde de démarrage.** GKE Autopilot doit provisionner un nœud, attacher le
  PVC et extraire l'image avant que `mongod` ne démarre. La sonde de démarrage permet jusqu'à
  ~8 minutes (`failure_threshold = 45`, vérifiant toutes les 10 secondes) pour s'adapter à cela. Lors des
  redémarrages de pod ultérieurs sur un nœud chaud, le démarrage est beaucoup plus rapide.
- **Vidage du journal à l'arrêt.** `termination_grace_period_seconds` est défini sur
  60 secondes (par défaut) afin que Kubernetes attende que `mongod` vide le journal
  d'écriture anticipée avant de tuer de force le processus — empêchant la corruption du journal.
- **Chaîne de connexion.** Le format correct pour se connecter avec les identifiants root est :
  ```
  mongodb://<username>:<password>@<host>:<port>/<db>?authSource=admin
  ```
  Le paramètre `authSource=admin` est requis lors de la connexion à des bases de données
  non-administratives avec le compte root.
- **Sondes de santé.** Les sondes de démarrage et de vivacité utilisent toutes deux `type = "TCP"` sur
  le port 27017. MongoDB utilise son propre protocole filaire binaire — les sondes HTTP échouent
  toujours avec une erreur de protocole.
- **Pas de tâches planifiées.** MongoDB ne nécessite pas de tâches cron côté plateforme.
  Les tâches au niveau de l'application (création d'index, index TTL) sont gérées depuis
  l'application ou via `mongosh`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour MongoDB sont listés ;
toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement et ses
valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mongodb` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `MongoDB` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `7.0` | Tag de version de l'image MongoDB ; incrémenter pour déployer une nouvelle version. Les mises à niveau majeures modifient le format sur disque — tester sur un réplica avant de mettre à niveau la production. |
| `mongo_root_username` | `admin` | Nom d'utilisateur root (`MONGO_INITDB_ROOT_USERNAME`). **Immuable après la première écriture du PVC.** |
| `mongo_initdb_database` | `admin` | Base de données initiale créée au premier démarrage. **Immuable après la première écriture du PVC.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. Mettre à l'échelle à `2000m` pour les charges de travail à forte agrégation. |
| `memory_limit` | `2Gi` | Mémoire par pod. Cache WiredTiger ≈ `(limit − 1 GiB) × 0.5` ; mettre à l'échelle à `4Gi`–`8Gi` pour la production. |
| `min_instance_count` | `1` | Réplicas minimum. Doit être 1 pour le mode nœud unique. |
| `max_instance_count` | `1` | Réplicas maximum. **Forcé à 1** — les réplicas ne sont pas pris en charge par ce module. |
| `container_port` | `27017` | Port du protocole filaire MongoDB. Définit à la fois le port du service et le port d'écoute de `mongod`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image `mongo` dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `MONGO_INITDB_ROOT_USERNAME` et `MONGO_INITDB_DATABASE` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager injectées en tant que variables d'environnement. Fournir `MONGO_INITDB_ROOT_PASSWORD` ici pour utiliser un mot de passe personnalisé au lieu de celui auto-généré. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret du mot de passe root avant le démarrage du pod. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | `ClusterIP` restreint l'accès à l'intérieur du cluster (suffisant pour les consommateurs intra-cluster via DNS) ; `LoadBalancer` expose le port 27017 avec une IP externe. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucune persistance de session requise pour les connexions au protocole filaire MongoDB. |
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laisser vide pour générer automatiquement. |
| `termination_grace_period_seconds` | `60` | Période de grâce pour `mongod` pour vider le journal avant SIGKILL. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement du StatefulSet (couvre le provisionnement du nœud + l'attachement du PVC). |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy pour restreindre l'entrée/sortie. |

### Groupe 7 — StatefulSet et PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définir `true` pour activer le StatefulSet basé sur PVC. **Requis pour la durabilité des données.** |
| `stateful_pvc_size` | `20Gi` | Taille de stockage. Ne peut pas être diminuée après la création ; provisionner 2 à 3 fois le volume de données attendu. |
| `stateful_pvc_mount_path` | `/data/db` | Doit correspondre à `--dbpath` de MongoDB. Ne pas modifier. |
| `stateful_pvc_storage_class` | `standard-rwo` | Valeur par défaut SSD GKE Autopilot. Utiliser `premium-rwo` pour les charges de travail à haut débit. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création de pod `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID fsGroup (note : `999` est **codé en dur** dans le module pour MongoDB — cette variable n'a aucun effet). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant une interruption (pour un MongoDB à nœud unique, `1` est la seule valeur sensée). |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, délai de 20s, failure_threshold 18 | Entrée de sonde TCP au niveau de la fondation sur le port 27017. La sonde de démarrage réelle du conteneur est codée en dur dans le module à `failure_threshold = 45` (~8 minutes) pour couvrir le provisionnement du nœud GKE Autopilot + l'attachement du PVC + le tirage d'image — voir [Section 3](#3-mongodb-application-behaviour). |
| `health_check_config` | TCP, délai de 30s, failure_threshold 3 | Sonde de vivacité TCP sur le port 27017. |
| `uptime_check_config` | désactivé | Vérification de la disponibilité — désactivée par défaut car MongoDB est un service interne. |
| `alert_policies` | `[]` | Politiques d'alerte de métriques Cloud Monitoring facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs Kubernetes exécutés avant le démarrage du pod MongoDB. Non requis pour MongoDB — aucun job d'amorçage de base de données n'est nécessaire. |
| `cron_jobs` | `[]` | CronJobs planifiés. MongoDB n'a pas de tâches planifiées côté plateforme requises. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas requis pour MongoDB — utiliser le PVC StatefulSet à la place. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | MongoDB ne nécessite pas de bucket GCS. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK pour le stockage et le registre. |
| `max_images_to_retain` | `7` | Images récentes à conserver dans Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique `mongodump` (UTC). **Vérifier que le job de sauvegarde est actif** — une sauvegarde manquée combinée à la suppression du PVC entraîne une perte de données permanente. |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'ingress HTTPS de la passerelle (nom d'hôte `<ip>.nip.io` sans configuration lorsque `application_domains` est vide) — inhabituel pour un service de base de données non HTTP ; le trafic `mongodb://` réel est servi par le service LoadBalancer L4, pas par cet ingress HTTP(S). |
| `application_domains` | `[]` | Noms de domaine personnalisés. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod pour les règles de pare-feu. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

IAP n'est pas recommandé pour MongoDB (une base de données, pas une application web). Restreindre
l'accès plutôt via `service_type = "ClusterIP"` ou Kubernetes NetworkPolicy.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Non recommandé pour MongoDB. Utiliser NetworkPolicy ou ClusterIP. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsque le type de service est LoadBalancer). |
| `mongodb_endpoint` | URI de connexion MongoDB prête à l'emploi (`mongodb://...`). Les déploiements ClusterIP renvoient l'URI DNS intra-cluster ; les déploiements LoadBalancer renvoient l'URI externe. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut pour MongoDB). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation exécutés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC, toutes les données MongoDB sont perdues à chaque redémarrage de pod, mise à jour continue ou éviction de nœud. |
| `stateful_pvc_mount_path` | `/data/db` (par défaut) | Critique | Doit correspondre à `--dbpath` de MongoDB. Monter ailleurs entraîne l'écriture de `mongod` dans la couche éphémère — toutes les données sont perdues au redémarrage. |
| `MONGO_INITDB_ROOT_PASSWORD` | auto-généré (par défaut) | Critique | MongoDB démarre sans authentification si la variable d'environnement est absente. Tout appelant à l'intérieur du cluster obtient un accès administrateur illimité. Ne jamais le supprimer ou l'effacer. |
| `mongo_root_username` / `mongo_initdb_database` | défini une fois | Critique | Intégré au répertoire de données lors de la première initialisation. La modification après l'existence du PVC entraîne un échec de démarrage. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires (`4Gi`) | Critique | Les entiers bruts sont lus comme des octets par Kubernetes, bloquant toute planification de pod. |
| `stateful_pvc_size` | `20Gi` min, taille pour la charge de travail | Élevé | Un disque plein provoque le crash de `mongod` avec `No space left on device`. Provisionner 2 à 3 fois le volume de données attendu. La taille ne peut pas être diminuée après la création. |
| `memory_limit` | `4Gi` pour la production | Élevé | Le cache WiredTiger représente ~50 % de `(limit − 1 GiB)`. Un cache insuffisant entraîne des E/S disque excessives et une grave dégradation des requêtes. |
| `workload_type` | `null` (StatefulSet automatique avec PVC) | Élevé | Définir explicitement `Deployment` avec `stateful_pvc_enabled = true` échoue au moment de la planification. MongoDB autonome nécessite StatefulSet pour une liaison PVC stable. |
| `application_version` | tester d'abord les mises à niveau majeures | Élevé | Les mises à niveau majeures de version de MongoDB modifient le format de stockage sur disque. La rétrogradation n'est pas prise en charge. Toujours tester sur un réplica du PVC de production. |
| `backup_schedule` | actif et testé | Élevé | MongoDB n'a pas de sauvegarde automatique intégrée en dehors du job `mongodump` de ce module. Une sauvegarde manquée combinée à la suppression du volume persistant lors de la destruction entraîne une perte de données permanente. |
| `service_type` | `ClusterIP` pour les services de niveau DB (déjà par défaut) | Élevé | `LoadBalancer` expose le port 27017 avec une IP publique. Laisser la valeur par défaut `ClusterIP` en place à moins qu'un accès externe ne soit explicitement requis, et utiliser des règles de pare-feu ou NetworkPolicy si vous le modifiez. |
| `termination_grace_period_seconds` | `60` (par défaut) | Élevé | Une période de grâce trop courte risque la corruption du journal à l'arrêt si les écritures en cours n'ont pas été vidées. |
| `cpu_limit` | `2000m` pour la production | Moyen | Les pipelines d'agrégation et les constructions d'index sont gourmands en CPU. En dessous de `500m`, les requêtes complexes se dégradent considérablement. |
| `replica set` | autonome uniquement | Élevé | Ce module est à nœud unique. Les flux de modifications, les transactions et la réplication d'oplog nécessitent un réplica — utiliser un déploiement basé sur Helm pour les topologies multi-nœuds. |
| `enable_iap` | `false` (par défaut) | Faible | IAP n'est pas applicable aux services de base de données. Utiliser NetworkPolicy ou ClusterIP pour le contrôle d'accès à la place. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. MongoDB_GKE n'a pas de module commun séparé ; toute
la configuration spécifique à MongoDB est autonome dans le module.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : MongoDB sur GKE Autopilot](../labs/MongoDB_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- Déployé aux côtés d'[Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), de [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md), de [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) dans la solution **Shared Data Services**.
