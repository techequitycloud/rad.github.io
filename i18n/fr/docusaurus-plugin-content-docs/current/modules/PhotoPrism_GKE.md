---
title: "PhotoPrism sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de PhotoPrism sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PhotoPrism_GKE.md @ 1665a43e sha256:fa795a8fba9f -->

# PhotoPrism sur GKE Autopilot {#photoprism-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhotoPrism_GKE.png" alt="PhotoPrism sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PhotoPrism est une application auto-hébergée de gestion de photos et de vidéos
basée sur l'IA : elle parcourt, organise et partage une bibliothèque multimédia
personnelle avec un étiquetage automatique, une reconnaissance faciale et une
recherche plein texte/visuelle, le tout servi à partir d'un seul binaire Go
avec une base de données SQLite intégrée. Ce module déploie PhotoPrism sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par PhotoPrism et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de PhotoPrism sur RAD et comparaison {#what-photoprism-costs-on-rad-and-how-that-compares}

**L'exécution de PhotoPrism dans votre propre projet Google Cloud coûte environ
45,68 $ US/mois en infrastructure, plus des frais de module uniques de 75
crédits RAD** (dimensionnés à 1 vCPU / 2 GiB sur les pods GKE Autopilot). RAD
facture les frais de module une seule fois, au moment du déploiement — jamais
plus lors d'une mise à jour — plus le temps de build mesuré en crédits ;
l'utilisation de Google Cloud elle-même est facturée à votre propre compte de
facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les
mêmes ressources sont mesurées toutes les heures en crédits au prix catalogue
plus la marge de RAD — environ 69 crédits/jour — et les frais de module sont
inférieurs de 10 %, soit 67,50 crédits. Voir "Mettre en pause gratuitement"
ci-dessous pour savoir comment un déploiement PhotoPrism géré par RAD peut être
arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin.
(ou voir le [guide Cloud Run](PhotoPrism_CloudRun.md) pour l'option à moindre
coût)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits (une fois) | 67,50 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~45,68 $/mois, facturés à votre propre compte de facturation au prix catalogue de Google | ~69 crédits/jour, mesurés toutes les heures au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 GiB | 39,68 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **45,68 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les
applications GKE exécutées dans le même projet, donc il est de 0 $ si c'est
votre seul cluster GKE.

### Comparaison {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement
  comparable, pour ce projet open-source exact, donc la comparaison honnête est
  un serveur auto-géré nu : Hetzner CPX22 (2 vCPU/4GB, ~24 $/mois), un Droplet
  DigitalOcean 2 vCPU/4GB (~24 $/mois), ou un GCP Compute Engine e2-standard-2
  (2 vCPU/8GB, ~49 $/mois).
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est
  généralement pas le cas. Ce que RAD ajoute pour un montant en dollars
  identique ou similaire, c'est une base de données gérée, des
  identifiants conservés dans Secret Manager, la surveillance et une mise à
  jour en un clic, ce qu'un VPS nu ne vous offre pas gratuitement.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du
  système d'exploitation/de la base de données, qui effectuez et testez les
  sauvegardes, et qui renouvelez les certificats ; les services Cloud SQL,
  Secret Manager et de surveillance gérés par RAD s'occupent des trois pour
  vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option phare sur un projet **géré par RAD**, et elle est gratuite
pendant la pause. La suppression d'un projet géré par RAD dissocie d'abord sa
facturation, puis demande à Google de supprimer le projet lui-même — la
suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne détruit pas la base de données, une VM
ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà dissociée, rien n'est facturé
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
propriétaire du projet (pas seulement faire gérer sa facturation par RAD), vous
devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime
définitivement — et la restauration est admise comme la création d'un nouveau
projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des études
et des démonstrations utilisent). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un
bucket à l'intérieur du projet, et ce bucket a la suppression logique de Cloud
Storage explicitement désactivée, de sorte que le bucket de sauvegarde est très
probablement supprimé dès que vous supprimez le projet — même si le projet
lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce
déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde
(vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour
une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **projet propre** (ou un projet géré par RAD au-delà de
sa fenêtre de restauration de 30 jours), est de supprimer PhotoPrism
purement et simplement et de le redéployer plus tard. Un redéploiement coûte
à nouveau les frais de module plus les builds — environ **78-81 crédits** au
total pour ce module.

La suppression ne permet d'économiser de l'argent que si PhotoPrism reste
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution — pour ce module, cela représente environ
6 jours ou plus d'inactivité, basé sur son propre coût d'exécution de 45,68
$ US/mois ci-dessus. La majeure partie de ce coût d'exécution est
généralement la base de données et toute VM de fichier/cache partagée, et
elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise,
donc la suppression de cette seule application n'économise que sa propre part
de calcul si quelque chose d'autre partage le projet.

**Conserver les données en premier :** les sauvegardes nocturnes sont
effectuées dans un bucket à l'intérieur du déploiement et sont supprimées avec
celui-ci. Copiez donc la dernière sauvegarde avant de la supprimer si vous
souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre
  projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin de
  la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Resource
Manager : supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

PhotoPrism s'exécute comme une charge de travail web binaire Go unique,
déployée en tant que **StatefulSet avec une Persistent Volume Claim de type
bloc** plutôt qu'un déploiement sans état. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod PhotoPrism sur le port 2342, StatefulSet par défaut |
| Base de données | Aucune | SQLite embarqué (`PHOTOPRISM_DATABASE_DRIVER=sqlite`) — aucune instance Cloud SQL n'est provisionnée |
| Stockage en mode bloc | Persistent Disk (PVC de type bloc) | `/photoprism` (base de données SQLite, cache, originaux, importations) — **requis**, gcsfuse ne peut pas sauvegarder SQLite en toute sécurité |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné mais n'est monté via GCS FUSE que si la PVC de type bloc est désactivée |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré (`PHOTOPRISM_ADMIN_PASSWORD`) |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est jamais provisionnée.** `PhotoPrism_Common`
  code en dur `database_type = "NONE"` et `enable_cloudsql_volume = false` ; PhotoPrism
  gère ses propres fichiers SQLite sous `/photoprism/storage`. Les variables
  GKE `database_type`/`application_database_*`/`enable_mysql_plugins`/etc.
  sont toutes des espaces réservés inertes transmis uniquement pour la
  compatibilité de la fondation.
- **La PVC de type bloc, et non gcsfuse, est obligatoire.** `stateful_pvc_enabled = true`
  par défaut, résolvant `workload_type` en `StatefulSet` et montant un
  Persistent Disk `standard-rwo` (SSD) de 20 GiB à `/photoprism`. gcsfuse ne
  peut pas héberger SQLite ou l'index multimédia en toute sécurité, donc le
  module définit automatiquement `enable_gcs_storage_volume = false` sur la couche commune
  lorsque la PVC est activée, évitant un double montage au même chemin.
- **Réplica unique, toujours.** `min_instance_count = 1`, `max_instance_count =
  1`. PhotoPrism
  sert une bibliothèque SQLite partagée à partir d'un volume inscriptible
  unique — ne pas dépasser 1.
- **Redis est désactivé de force.** La variable GKE `enable_redis`
  définit par défaut `true` (la valeur par défaut de la fondation
  App_GKE), mais `PhotoPrism_GKE`'s `main.tf` la
  remplace en dur par `false` — PhotoPrism n'a pas
  d'intégration Redis, donc aucun hôte Redis Memorystore/NFS n'est jamais
  injecté.
- **NFS est désactivé par défaut** (`enable_nfs = false`). La PVC de type bloc
  est le stockage durable ; NFS n'est pas nécessaire à moins d'ajouter des jobs
  / services personnalisés qui nécessitent un accès partagé au système de
  fichiers.
- **Le mot de passe administrateur est auto-généré.** Un mot de passe de 24
  caractères est créé et stocké dans Secret Manager, puis injecté en tant que
  variable d'environnement secrète `PHOTOPRISM_ADMIN_PASSWORD` ; le nom d'utilisateur
  administrateur est la variable simple `admin_username` (par défaut
  `admin`).
- **Le build d'image personnalisé est un miroir fin, pas une logique
  d'application.** Le build encapsule l'image amont `photoprism/photoprism`
  (`FROM photoprism/photoprism:${PHOTOPRISM_VERSION}`) afin que la Fondation puisse la refléter dans Artifact
  Registry ; l'argument de build spécifique à l'application est
  `PHOTOPRISM_VERSION` (pas le générique `APP_VERSION`), épinglé à
  `240915` lorsque `application_version = "latest"`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet PhotoPrism {#a-gke-autopilot--the-photoprism-statefulset}

PhotoPrism s'exécute en tant que **StatefulSet** (et non en tant que
Déploiement) afin que son pod unique obtienne une identité stable et un
redémarrage ordonné, correspondant à sa PVC de type bloc inscriptible unique.
Autopilot facture le CPU/la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez le
  StatefulSet PhotoPrism pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Stockage en mode bloc persistant (Persistent Disk) {#b-persistent-block-storage-persistent-disk}

Tout l'état de PhotoPrism — la base de données SQLite et le cache
(`/photoprism/storage`), les médias importés (`/photoprism/originals`) et les
importations en attente (`/photoprism/import`) — réside sur une seule PVC de
type bloc par pod provisionnée par le StatefulSet à `/photoprism`,
soutenue par la StorageClass `standard-rwo` (Persistent Disk équilibré /
SSD) par défaut, d'une taille de `20Gi`.

- **Console :** Kubernetes Engine → Stockage → Persistent Volume Claims ;
  Compute Engine → Disques.
- **CLI :**
  ```bash
  kubectl get pvc,pv -n "$NAMESPACE"
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement de PVC StatefulSet, les
options StorageClass et la mise en garde sur le quota GKE `SSD_TOTAL_GB`.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
par défaut (`create_cloud_storage = true`), mais il n'est monté dans le pod via GCS
FUSE que lorsque la PVC de type bloc est désactivée
(`stateful_pvc_enabled = false`) — dans la configuration StatefulSet par défaut, le
bucket existe mais n'est pas utilisé par le conteneur en cours d'exécution.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages du pilote CSI
GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : le mot de passe administrateur de
PhotoPrism (`secret-<prefix>-photoprism-admin-password`), injecté dans le conteneur en tant que
`PHOTOPRISM_ADMIN_PASSWORD`. Sur GKE, les secrets sont projetés dans les pods via le
pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~photoprism-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via un service `LoadBalancer`
(`service_type = "LoadBalancer"`) — PhotoPrism est une interface web publique, pas une
charge de travail de base de données ; passez à `ClusterIP` pour un
accès interne uniquement, ou activez un domaine personnalisé
(`enable_custom_domain = true` par défaut) via l'API Kubernetes Gateway avec un
certificat géré par Google.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard et d'erreur des pods sont acheminées vers Cloud Logging ;
les métriques GKE sont acheminées vers Cloud Monitoring. Une vérification de
disponibilité optionnelle (`uptime_check_config`, désactivée par défaut) et des
stratégies d'alerte personnalisées sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application PhotoPrism {#3-photoprism-application-behaviour}

- **Pas de job d'initialisation/création de base de données.** `initialization_jobs`
  est par défaut `[]` — il n'y a pas de base de données à
  amorcer. PhotoPrism crée et migre son propre schéma SQLite au premier
  démarrage, sous la PVC de type bloc montée.
- **Disposition du stockage.** Tout l'état réside sous le répertoire monté
  unique `/photoprism` : `PHOTOPRISM_STORAGE_PATH=/photoprism/storage` (base de données SQLite +
  cache), `PHOTOPRISM_ORIGINALS_PATH=/photoprism/originals` (médias importés/indexés),
  `PHOTOPRISM_IMPORT_PATH=/photoprism/import` (importations en attente).
- **Compte administrateur.** `PHOTOPRISM_ADMIN_USER` est la variable simple
  `admin_username` (par défaut `admin`) ; `PHOTOPRISM_ADMIN_PASSWORD` est la
  valeur auto-générée de Secret Manager, injectée comme variable d'environnement
  secrète. `PHOTOPRISM_AUTH_MODE = "password"` est défini explicitement. Récupérez le mot de
  passe de Secret Manager avant la première connexion.
- **URL du site.** `PHOTOPRISM_SITE_URL` est vide par défaut — PhotoPrism le
  tolère et se rabat sur l'hôte de la requête, mais définissez
  `site_url` sur l'URL déployée pour des liens absolus générés
  correctement.
- **fsGroup pour la PVC.** PhotoPrism s'exécute en tant que UID 1000 / GID
  2000 ; le StatefulSet définit `stateful_fs_group = 3000` (la convention du
  chart Helm amont) afin que la PVC montée soit inscriptible par le groupe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux
  **HTTP** `GET /api/v1/status` (délai initial 15s / 10 tentatives pour le
  démarrage, 30s / 3 tentatives pour la vivacité) — aucune authentification
  requise. Les variables de niveau fondation du Groupe 10
  `startup_probe_config`/`health_check_config` reflètent le même chemin que les
  valeurs par défaut génériques. {/* TODO: vérifier la précédence si les deux
  surfaces de configuration de sonde (startup_probe/liveness_probe au niveau
  commun vs. startup_probe_config/health_check_config du Groupe 10) sont
  définies avec des valeurs conflictuelles. */}
- **La mise à l'échelle est limitée à un pod.** `min_instance_count = 1` et
  `max_instance_count = 1` — PhotoPrism conserve une seule base de données SQLite
  inscriptible et un seul volume multimédia inscriptible ; il n'y a pas de
  prise en charge multi-écrivains.
- **Inspecter la configuration et le stockage en cours d'exécution :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep PHOTOPRISM_
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
PhotoPrism sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `photoprism` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `photoprism/photoprism` utilisé comme base de build personnalisé ; `latest` est épinglé à un tag connu et fonctionnel (`240915`) au moment du build. |
| `admin_username` | `admin` | Nom d'utilisateur du compte administrateur initial (`PHOTOPRISM_ADMIN_USER`) ; le mot de passe est généré séparément. |
| `site_url` | `""` | URL publique du site (`PHOTOPRISM_SITE_URL`). Vide, se rabat sur l'hôte de la requête ; à définir une fois que l'URL externe est connue pour des liens absolus corrects. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU alloué au conteneur PhotoPrism. L'indexation/la création de vignettes est limitée par le CPU ; augmentez pour les grandes bibliothèques. |
| `memory_limit` | `2Gi` | Mémoire allouée au conteneur. PhotoPrism charge les index vectoriels en mémoire ; 2 GiB est le minimum qui maintient la reconnaissance faciale/le support RAW activés — augmentez vers 4 GiB pour les grandes collections. |
| `min_instance_count` | `1` | Maintenez à 1 pour éviter les démarrages à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | **Maintenez à 1** — base de données SQLite et volume multimédia inscriptibles uniques. |
| `container_port` | `2342` | Non transmis à App_GKE ; PhotoPrism sert toujours sur le port 2342, fixé par `PhotoPrism_Common`. |
| `enable_cloudsql_volume` | `false` | Pas de sidecar Cloud SQL Auth Proxy — PhotoPrism n'a pas de base de données externe. |

### Groupe 7 — StatefulSet (PVC de type bloc) {#group-7--statefulset-block-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Requis.** gcsfuse ne peut pas sauvegarder SQLite/l'index multimédia en toute sécurité ; lorsque vrai sans `workload_type` explicite, se résout en `StatefulSet` et désactive automatiquement le volume de stockage GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Dimensionnez la PVC pour contenir toutes les collections plus les frais généraux. |
| `stateful_pvc_mount_path` | `/photoprism` | Répertoire de données de PhotoPrism — couvre `storage` (SQLite/cache) et `originals`. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré (SSD) — utilise le quota `SSD_TOTAL_GB` ; voir §6. |
| `stateful_fs_group` | `3000` | GID pour `fsGroup` au niveau du pod ; PhotoPrism s'exécute en tant que UID 1000/GID 2000. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Redémarrages sûrs et ordonnés pour une charge de travail à pod unique avec état. |

### Groupe 10 — Santé et observabilité {#group-10--health--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` (Commun) | HTTP `/api/v1/status`, 15s de délai, 10 tentatives | Appliqué au conteneur PhotoPrism. |
| `liveness_probe` (Commun) | HTTP `/api/v1/status`, 30s de délai, 3 tentatives | Appliqué au conteneur PhotoPrism. |
| `uptime_check_config` | `enabled = false`, chemin `/api/v1/status` | Vérification de disponibilité externe optionnelle ; désactivée par défaut. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` même s'il n'est pas utilisé lorsque la PVC de type bloc (par défaut) est active. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires au-delà du volume de stockage PhotoPrism (géré automatiquement). |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) → **forcé `false`** | `main.tf` remplace en dur cette valeur par `false` quelle que soit la valeur passée — PhotoPrism n'a pas d'intégration Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — PhotoPrism n'a pas de base de données SQL (uniquement SQLite embarqué). Toutes les autres variables `database_*`/`application_database_*`/plugin MySQL de ce groupe sont inertes, transmises uniquement pour la compatibilité de la fondation. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | API Kubernetes Gateway + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés ; requis si `enable_custom_domain` est laissé `true` sans fallback `LoadBalancer`. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

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
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre PhotoPrism. |
| `photoprism_admin_password_secret_id` | ID du secret Secret Manager contenant le mot de passe administrateur généré. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés. |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans
> identités autorisées, `quota_memory_*` donné comme des entiers nus, un
> `container_port`/`backup_retention_days` hors de portée. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver revient à utiliser GCS FUSE, qui ne peut pas héberger SQLite ou l'index multimédia en toute sécurité — risque de corruption. |
| `max_instance_count` | `1` | Critique | Mettre à l'échelle au-delà de 1 donne à deux pods une seule base de données SQLite et une seule PVC inscriptibles — corruption/conflit de verrouillage. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) — envisager `standard` (HDD) | Moyen–Élevé | `standard-rwo` utilise le quota régional strict `SSD_TOTAL_GB` (500 Go sur Qwiklabs) ; une campagne d'applications avec état peut l'épuiser vers l'application n°8. PhotoPrism n'a pas besoin d'IOPS SSD pour la correction, seulement pour le débit d'indexation/de création de vignettes — remplacez par HDD (`-var stateful_pvc_storage_class=standard`) sur les projets à quota limité. |
| `enable_redis` | Forcé `false` dans `main.tf` | Faible | Aucune action nécessaire — la surcharge est intentionnelle et ne peut être annulée en définissant la variable `true`. |
| `create_cloud_storage` | `true` | Faible | Le bucket `storage` est créé mais inutilisé lorsque la PVC de type bloc est active ; inoffensif, coût de stockage inactif mineur. |
| `PHOTOPRISM_ADMIN_PASSWORD` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous empêche d'accéder au premier compte administrateur jusqu'à la réinitialisation via la base de données. |
| `site_url` | Définir sur l'URL déployée une fois connue | Moyen | Laissé vide, PhotoPrism se rabat sur l'hôte de la requête ; les liens absolus/URL de vignettes peuvent être incorrects derrière un proxy ou un domaine personnalisé. |
| `stateful_fs_group` | `3000` | Élevé | Un fsGroup non concordant ou non défini peut rendre la PVC non inscriptible par l'UID 1000/GID 2000 de PhotoPrism, bloquant le démarrage. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS et `site_url`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
PhotoPrism partagée avec la variante Cloud Run est décrite dans
**[PhotoPrism_Common](PhotoPrism_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PhotoPrism sur GKE Autopilot](../labs/PhotoPrism_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [PhotoPrism sur Google Cloud Run](PhotoPrism_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [PhotoPrism Common — Configuration d'application partagée](PhotoPrism_Common.md) — la configuration partagée par les deux cibles de déploiement.
