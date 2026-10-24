---
title: "Wiki.js sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Wiki.js sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wikijs_GKE.md @ e69407af sha256:1b75a43f1c24 -->

# Wiki.js sur GKE Autopilot {#wikijs-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wikijs_GKE.png" alt="Wiki.js sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wiki.js est une puissante plateforme wiki open source conçue pour les équipes qui ont besoin d'une gestion des connaissances moderne et rapide avec un contrôle de version basé sur Git et une expérience d'écriture claire. Ce module déploie Wiki.js sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Wiki.js et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de Wiki.js sur RAD et comparaison {#what-wikijs-costs-on-rad-and-how-that-compares}

**L'exécution de pods Wiki.js sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 110,13 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 110 crédits facturé une seule fois au moment du déploiement. Wiki.js a besoin d'une base de données PostgreSQL et d'un serveur de fichiers NFS/cache partagé derrière elle, ce qui représente la majeure partie des 110,13 $ ci-dessus. Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Wikijs_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 110,13 $/mois, facturé par Google au prix catalogue | ~99 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 GiB | 39,68 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **110,13 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est le seul, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comparaison {#how-it-compares}

- Wiki.js n'a pas de version SaaS hébergée officielle — comme la plupart des wikis auto-hébergés, il n'est livré que sous forme de logiciel que vous exécutez vous-même, donc la comparaison est "gérer un VPS" vs "laisser RAD gérer la même pile", pas RAD vs un abonnement.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go est le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est environ 49 $/mois — n'importe lequel de ces éléments est suffisant pour exécuter Wiki.js et sa base de données Postgres ensemble dans Docker Compose sur une seule machine, à un prix affiché inférieur à celui de la pile gérée par RAD.
- Ce que ce prix n'inclut pas : les sauvegardes, les correctifs de sécurité, le renouvellement TLS et les pages de disque plein à 2h du matin, tout ce que Cloud SQL, Secret Manager et la surveillance gérés par RAD absorbent pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne **détruit pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique
de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Wiki.js et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et la remise en service de Wiki.js signifie un redéploiement à partir de
zéro. Cela coûte environ 113-116 crédits (les frais de module de 110 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Wiki.js reste inutilisé suffisamment longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Wiki.js, cela représente environ 4 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée — celles-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur.
Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Wiki.js s'exécute comme une charge de travail web Node.js. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 2 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Wiki.js utilise PostgreSQL avec l'extension `pg_trgm` pour la recherche en texte intégral |
| Fichiers partagés | Filestore (NFS) | Actifs téléchargés partagés entre toutes les répliques |
| Stockage d'objets | Cloud Storage | Un bucket `wikijs-storage` dédié, montable via GCS Fuse à `/wiki-storage` |
| Cache (optionnel) | Redis | Désactivé par défaut ; activer pour la mise en cache de session dans les déploiements multi-répliques |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ; l'utilisation de MySQL ou `NONE`
  empêche le démarrage. L'extension `pg_trgm` est installée automatiquement et est requise
  pour la recherche en texte intégral de Wiki.js.
- **NFS est activé par défaut.** Avec plus d'une réplique, un volume NFS partagé est
  requis pour que tous les pods voient les mêmes fichiers téléchargés.
- **Port 3000.** Wiki.js se lie au port 3000, et non aux ports conventionnels 80 ou 8080.
- **L'affinité de session est `ClientIP`.** Wiki.js maintient le contexte de session en mémoire ;
  le routage persistant maintient les requêtes d'un utilisateur sur le même pod.
- **La base de données est amorcée lors du premier déploiement** par un job `db-init` qui crée
  l'utilisateur PostgreSQL, la base de données et le schéma. La sonde de démarrage utilise `/healthz` avec un
  délai initial de 60 secondes pour permettre cela.
- **Le chemin de stockage des actifs est important.** `HA_STORAGE_PATH=/wiki-storage` indique à Wiki.js où
  écrire les téléchargements. Le volume NFS ou GCS Fuse doit être monté au même chemin.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Wiki.js {#a-gke-autopilot--the-wikijs-workload}

Les pods Wiki.js sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de répliques.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Wiki.js pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Wiki.js stocke toutes les données d'application (pages, utilisateurs, navigation, index de recherche) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. L'extension `pg_trgm` est installée
au moment du provisionnement et alimente la recherche en texte intégral native de Wiki.js. Les pods atteignent la
base de données en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix,
de sorte qu'aucune adresse IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la
base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les actifs téléchargés sont écrits dans un partage **Filestore (NFS)** monté dans chaque pod afin que
toutes les répliques voient les mêmes fichiers. Un bucket **Cloud Storage** dédié (`wikijs-storage`)
est également provisionné pour le stockage persistant des actifs ; il peut être monté à `/wiki-storage`
via le pilote CSI GCS Fuse.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket de stockage.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis (optionnel) {#d-redis-cache-optional}

Redis est désactivé par défaut. Lorsqu'il est activé, il fournit une mise en cache de session entre
les répliques. Définissez `enable_redis = true` et fournissez `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager et injecté dans les pods au
moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et Ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut
être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Wiki.js {#3-wikijs-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) utilise l'image
  `postgres:15-alpine` pour se connecter via le Cloud SQL Auth Proxy, créer de manière idempotente la base de données
  `wikijs` et l'utilisateur, et accorder les privilèges requis. L'extension PostgreSQL
  `pg_trgm` est ensuite installée par la fondation dans le cadre de la configuration
  `enable_postgres_extensions = true` / `postgres_extensions = ["pg_trgm"]` fournie par `Wikijs_Common`. Le job peut être réexécuté en toute sécurité.
- **Migration du schéma au premier démarrage.** Wiki.js se connecte à PostgreSQL au démarrage et
  exécute sa propre migration de schéma interne. C'est pourquoi la sonde de démarrage a un
  délai initial de 60 secondes — pour laisser le temps au schéma de la base de données d'être entièrement initialisé
  avant que les vérifications de santé ne commencent.
- **Chemin de stockage des actifs.** Wiki.js écrit les fichiers téléchargés dans le chemin défini par
  `HA_STORAGE_PATH` (par défaut `/wiki-storage`). Le chemin de montage NFS et cette variable
  doivent pointer vers le même emplacement physique. Avec `enable_nfs = true`, montez le partage NFS
  à `/wiki-storage` ou modifiez `nfs_mount_path` et `HA_STORAGE_PATH` ensemble.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité utilisent toutes deux `/healthz`, qui
  renvoie HTTP 200 uniquement lorsque Wiki.js est en cours d'exécution et connecté à PostgreSQL. Ne
  remplacez pas cela par `/` — le chemin de l'interface utilisateur est lent à rendre et peut renvoyer des erreurs pendant
  le démarrage.
- **Affinité de session.** `session_affinity = "ClientIP"` est la valeur par défaut. Wiki.js
  maintient le contexte de session en mémoire ; le routage persistant maintient une session de navigateur sur le
  même pod.
- **Redis est optionnel.** Wiki.js ne nécessite pas Redis pour son fonctionnement principal. Activez-le
  lorsque vous souhaitez une mise en cache de session au niveau de l'application dans les déploiements multi-répliques.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Wiki.js sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wikijs` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Wiki.js` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.5.311` | Tag de version de l'image Wiki.js ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build ; `prebuilt` utilise une URI d'image existante. |
| `container_image` | `requarks/wiki:2` | Image Docker Hub en amont utilisée comme base de Cloud Build. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Requêtes/limites de ressources par pod. |
| `container_port` | `3000` | Port du serveur Node.js de Wiki.js — ne pas modifier. |
| `min_instance_count` | `1` | Répliques minimales (garder ≥ 1 pour éviter les démarrages à froid). |
| `max_instance_count` | `3` | Répliques maximales (plafond de l'autoscaler). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `enable_image_mirroring` | `true` | Mettre en miroir `requarks/wiki:2` de Docker Hub vers Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ DB_TYPE="postgres", DB_PORT="5432", DB_USER="wikijs", DB_NAME="wikijs", DB_SSL="false", HA_STORAGE_PATH="/wiki-storage" }` | Pré-rempli avec les paramètres de connectivité de la base de données Wiki.js. Valeurs essentielles — ne pas supprimer. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `DB_PASS` est câblé automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant pour le contexte de session en mémoire. |
| `workload_type` | `null` | Se résout automatiquement en Déploiement ; définir `StatefulSet` pour le stockage par pod. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS — ne pas supprimer. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC dans un StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage à l'intérieur de chaque pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter le nombre de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, délai initial de 60 s | Sonde de démarrage — délai généreux pour la migration de la base de données au premier démarrage. |
| `health_check_config` | HTTP `/healthz`, délai initial de 60 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré de `Wikijs_Common`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par exemple, exportations ou sauvegardes planifiées). |
| `additional_services` | `[]` | Déploiements sidecar ou auxiliaires aux côtés de Wiki.js. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les actifs Wiki.js (garder activé pour les répliques multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur — doit correspondre à `HA_STORAGE_PATH`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de stockage. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket `wikijs-storage`. |
| `gcs_volumes` | `[]` | Monter le bucket `wikijs-storage` via GCS Fuse à `/wiki-storage`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour la mise en cache de session (optionnel pour Wiki.js). |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true` **sauf si** `enable_nfs = true`, auquel cas l'adresse IP du serveur NFS est utilisée comme hôte Redis par défaut. `enable_nfs` est par défaut `true` pour ce module, donc `redis_host` n'est pas réellement requis dans la configuration par défaut. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Wiki.js nécessite PostgreSQL. |
| `application_database_name` | `wikijs` | Nom de la base de données. Immuable après le premier déploiement ; doit correspondre à `DB_NAME`. |
| `application_database_user` | `wikijs` | Utilisateur de l'application. Immuable après le premier déploiement ; doit correspondre à `DB_USER`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_postgres_extensions` | `true` | Installer les extensions — requis pour `pg_trgm`. |
| `postgres_extensions` | `["pg_trgm"]` | Requis pour la recherche en texte intégral. Ne pas supprimer. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Wiki.js. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Wiki.js. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Wiki.js nécessite PostgreSQL ; MySQL/`NONE` empêche le démarrage. |
| `application_database_name` / `DB_NAME` | les deux `wikijs` | Critique | Incohérence : `db-init` crée une base de données différente de celle à laquelle Wiki.js se connecte — boucle de crash. Immuable après le premier déploiement. |
| `enable_postgres_extensions` / `postgres_extensions` | `true` / `["pg_trgm"]` | Critique | La suppression de `pg_trgm` désactive toute recherche en texte intégral avec une erreur de fonction introuvable. |
| `quota_memory_requests` / `_limits` | unités binaires (`Gi`, `Mi`) | Critique | Les entiers bruts sont des octets — bloque toute planification de pod. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_file` valide échoue au job d'importation. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation supprime le sidecar Auth Proxy — toutes les connexions PostgreSQL échouent. |
| `application_database_user` / `DB_USER` | les deux `wikijs` | Élevé | Incohérence : les autorisations sont créées pour un utilisateur mais Wiki.js s'authentifie en tant qu'un autre — échec d'authentification. |
| `enable_nfs` | `true` | Élevé | Sans stockage partagé, les téléchargements écrits par un pod sont invisibles pour les autres et perdus au redémarrage. |
| `nfs_mount_path` + `HA_STORAGE_PATH` | les deux `/wiki-storage` | Élevé | Si le chemin de montage NFS et `HA_STORAGE_PATH` ne correspondent pas, Wiki.js écrit sur le disque éphémère du pod. |
| `container_resources.memory_limit` | `2Gi` | Élevé | En dessous de `1Gi`, Wiki.js est tué par manque de mémoire au démarrage ou sous charge. |
| `startup_probe_config.initial_delay_seconds` | `60` | Élevé | Trop faible — Wiki.js est tué avant la fin de la migration du schéma au premier démarrage. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro provoque des démarrages à froid de 15 à 30 secondes et une reconnexion de la base de données en cours. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les déploiements multi-répliques perdent le contexte de session en mémoire. |
| `application_version` | `2.5.311` | Élevé | Wiki.js 2.x et 3.x ont des schémas incompatibles. Tester les mises à niveau en staging. |
| `network_tags` | `["nfsserver"]` | Élevé | La suppression du tag rompt la règle de pare-feu NFS — le montage échoue. |
| `enable_iap` / `enable_cloud_armor` | activer pour les wikis internes | Moyen | La page de connexion de Wiki.js est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `enable_redis` | `false` sauf si nécessaire | Faible | Wiki.js ne nécessite pas Redis pour son fonctionnement principal. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Wiki.js partagée avec la variante Cloud Run est décrite dans
**[Wikijs_Common](Wikijs_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Wiki.js sur GKE Autopilot](../labs/Wikijs_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Wiki.js sur Google Cloud Run](Wikijs_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wiki.js Common — Configuration d'application partagée](Wikijs_Common.md) — la configuration partagée par les deux cibles de déploiement.
