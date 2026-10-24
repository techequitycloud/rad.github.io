---
title: "Gotify sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Gotify sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gotify_GKE.md @ e69407af sha256:9c92789d9cc9 -->

# Gotify sur GKE Autopilot {#gotify-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gotify_GKE.png" alt="Gotify sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gotify est un serveur open-source (licence MIT) auto-hébergé pour l'envoi et la
réception de notifications push en temps réel. Les applications publient des
messages via une API REST simple et les clients les reçoivent instantanément via
des flux WebSocket. Ce module déploie Gotify sur **GKE Autopilot** au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Gotify et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Gotify sur RAD, et comment cela se compare {#what-gotify-costs-on-rad-and-how-that-compares}

**L'exécution de Gotify sur un pod GKE Autopilot dans votre propre projet Google Cloud coûte environ 91,31 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une fois au moment du déploiement. Le travail de Gotify est minime — accepter un webhook, le diffuser via WebSocket — mais ce déploiement nécessite toujours une base de données et un serveur de fichiers derrière lui, ce qui représente la majeure partie des 91,31 $ ci-dessus. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Gotify_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 91,31 $/mois, facturé par Google au prix catalogue | ~86 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 GB, zonal, 10 GB SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **91,31 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis sur le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — n'importe lequel de ces services est suffisant pour exécuter Gotify et sa base de données Postgres ensemble dans Docker Compose sur une seule machine, à un prix affiché inférieur à celui de la pile gérée par RAD.
- Ce que ce prix n'inclut pas : les sauvegardes, les correctifs de sécurité, le renouvellement TLS et les alertes de disque plein à 2h du matin, que le Cloud SQL géré par RAD, Secret Manager et la surveillance absorbent pour vous.
- Gotify n'a pas de version SaaS hébergée officielle — il n'est livré que sous forme de logiciel auto-hébergé, donc le choix est vraiment "gérer un VPS vous-même" ou "laisser RAD gérer la même pile", et non RAD contre un abonnement.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ni la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut pour cela : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Gotify et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de le supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime définitivement les ressources, et ramener Gotify signifie redéployer à partir de
zéro. Cela coûte environ 78-81 crédits (les 75 crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si Gotify restait inutilisé suffisamment longtemps pour compenser
le coût de redéploiement par rapport à son propre coût d'exécution — pour Gotify, cela représente environ 3 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise un, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Gotify s'exécute comme une charge de travail web Go à binaire unique. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 1 vCPU / 512 Mio de requête par défaut ; réplica unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — ce module n'utilise jamais le SQLite intégré de Gotify |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré (`GOTIFY_DEFAULTUSER_PASS`) ; mot de passe de base de données |
| Build de conteneur | Cloud Build + Artifact Registry | Encapsule `ghcr.io/gotify/server` avec un point d'entrée de mappage de base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES"` est la valeur par défaut du module ;
  le mode SQLite de Gotify n'est pas utilisé.
- **Le conteneur écoute sur le port 80.** `container_port = 80` et le point d'entrée définit
  `GOTIFY_SERVER_PORT = 80`.
- **Un réplica unique est la valeur par défaut sûre.** `min = max = 1`. Le bus de messages de Gotify est
  en cours de traitement, de sorte qu'un flux client ne reçoit que les messages livrés au pod auquel il est
  connecté. La mise à l'échelle au-delà d'un réplica sans couche de diffusion externe
  entraîne la perte de messages pour certains abonnés.
- **Un StatefulSet avec un PVC de bloc à `/app/data`.** Les messages vivent dans PostgreSQL, mais
  les images d'application et les plugins téléchargés sont écrits dans `/app/data`, donc
  `stateful_pvc_enabled = true` (par défaut) monte un PVC par pod là et la charge de travail
  se résout en un StatefulSet. Le PVC utilise la classe de stockage `standard` (HDD) — quelques
  petites images n'ont pas besoin de quota SSD.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret Manager,
  injecté comme `GOTIFY_DEFAULTUSER_PASS`. L'administrateur initial (`admin`) est créé lors de la
  première initialisation de la base de données uniquement.
- **Pas de stockage d'objets ou de NFS** (`storage_buckets = []`, `enable_nfs = false`) — le PVC
  contient le magasin d'images/plugins sur disque.
- **L'image est construite sur mesure.** `container_image_source = "custom"` encapsule
  `ghcr.io/gotify/server` et mappe les variables de plateforme `DB_*` sur la
  configuration `GOTIFY_DATABASE_*` (GORM) de Gotify ; sur GKE `DB_HOST` est `127.0.0.1` via le
  sidecar cloud-sql-proxy. `latest` s'ancre à la base `2.9.1`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Gotify {#a-gke-autopilot--the-gotify-workload}

Les pods Gotify sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Le module conserve un réplica unique afin que le bus de messages en cours de traitement
livre à chaque client connecté.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Gotify pour les pods et
  les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail sont
gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gotify stocke toutes les données d'application (messages, applications, clients, utilisateurs) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent en privé via le
sidecar **Cloud SQL Auth Proxy** (boucle locale `127.0.0.1`) ; aucune IP publique n'est exposée. Lors du
premier déploiement, un job d'initialisation crée la base de données et le rôle de l'application ; Gotify
applique ensuite son propre schéma via l'auto-migration GORM au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe sont tous dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le mot de passe administrateur (`GOTIFY_DEFAULTUSER_PASS`) est généré automatiquement et stocké
dans Secret Manager, matérialisé dans l'espace de noms via le pilote CSI Secret Store.
Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotify"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration CSI et la rotation.

### D. Build de conteneur et Artifact Registry {#d-container-build--artifact-registry}

L'image personnalisée encapsule `ghcr.io/gotify/server` avec un point d'entrée de mappage de base de données. Cloud
Build la construit et la pousse vers Artifact Registry ; `enable_image_mirroring = true`
met en miroir la base amont dans Artifact Registry pour éviter les limites de débit du registre.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être
réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring, avec un test de disponibilité contre `/health` et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gotify {#3-gotify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `create-db-and-user.sh`
  en utilisant `postgres:15-alpine`. Il se connecte via le proxy d'authentification Cloud SQL et
  crée de manière idempotente la base de données et le rôle de l'application et accorde les privilèges. Le
  job peut être réexécuté en toute sécurité.
- **Schéma via l'auto-migration GORM.** Gotify crée et migre ses propres tables à chaque
  démarrage — il n'y a pas de job de migration séparé. La mise à niveau de la version de l'application
  applique automatiquement les modifications de schéma.
- **Le compte administrateur est amorcé une seule fois.** `GOTIFY_DEFAULTUSER_NAME = admin` et
  le secret `GOTIFY_DEFAULTUSER_PASS` créent l'administrateur initial lors de la première
  initialisation de la base de données uniquement. Récupérez le mot de passe de Secret Manager et changez-le
  après la première connexion.
- **L'envoi et la réception sont authentifiés par jeton.** Après vous être connecté, créez une
  *application* (qui génère un jeton d'application) pour envoyer des messages via
  `POST /message?token=<apptoken>`, et utilisez un jeton *client* pour vous abonner via le
  WebSocket à `/stream?token=<clienttoken>`. Confirmez la santé sans jeton :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s http://<service-name>/health
  ```
- **Livraison WebSocket à réplica unique.** Étant donné que le bus de messages est en cours de traitement, conservez
  `max_instance_count = 1` à moins que vous n'ajoutiez une couche de diffusion externe — sinon un
  message envoyé à un pod n'est pas livré aux clients diffusant depuis un autre.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` — le point de terminaison public
  qui renvoie `{"health":"green","database":"green"}` une fois que PostgreSQL est accessible.
  La sonde de démarrage par défaut autorise ~5 minutes au premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Gotify sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotify` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Gotify` | Nom lisible par l'homme affiché dans la Console. |
| `application_description` | `Gotify push notification server on GKE Autopilot` | Description de la charge de travail. |
| `application_version` | `latest` | Tag d'image ; `latest` se résout en la base épinglée `2.9.1`. Épinglez une version en production. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | `custom` construit l'image wrapper de mappage de base de données ; `prebuilt` déploie une URI d'image que vous configurez. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Requêtes et limites de CPU/mémoire par pod. |
| `container_port` | `80` | Gotify écoute sur le port 80. |
| `min_instance_count` | `1` | HPA minReplicas. |
| `max_instance_count` | `1` | HPA maxReplicas. Gardez à 1 — le bus de messages en cours de traitement ne se diffuse pas sur plusieurs pods. |
| `workload_type` | `null` → `StatefulSet` | Se résout en un StatefulSet car le PVC est activé. |
| `stateful_pvc_enabled` | `true` | PVC par pod pour le magasin d'images/plugins téléchargés ; sans cela, ces fichiers sont perdus à chaque redémarrage. |
| `stateful_pvc_mount_path` | `/app/data` | Où Gotify écrit les images et les plugins. |
| `stateful_pvc_storage_class` | `standard` | HDD ; évite le quota SSD régional. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmentez pour les flux de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité. |
| `enable_image_mirroring` | `true` | Mettre en miroir `ghcr.io/gotify/server` dans Artifact Registry. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires `GOTIFY_*`. La connexion à la base de données et `GOTIFY_DEFAULTUSER_PASS` sont injectés automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `None` | Correct pour Gotify sans état — aucune session par pod n'est requise. |
| `namespace_name` | `""` | Auto-généré lorsqu'il est vide. |
| `network_tags` | `[]` | Tags réseau de nœud/pod pour les règles de pare-feu. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Doit utiliser des suffixes binaires (`4Gi`, `8192Mi`) — les entiers nus sont des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai de 30s, 30 échecs | Sonde de démarrage. `Gotify_GKE` mappe cette variable dans le propre `startup_probe` de la charge de travail Gotify (via `Gotify_Common`), c'est donc la valeur qui régule réellement la disponibilité — permet ~5 minutes au premier démarrage. |
| `health_check_config` | HTTP `/health`, délai de 30s | Sonde de vivacité. Également mappée dans le `liveness_probe` de la charge de travail. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires aux côtés de Gotify. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — le PVC de bloc persiste déjà le magasin d'images/plugins. |
| `nfs_mount_path` | `/app/data` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Gotify est sans état dans ce module. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Gotify utilise PostgreSQL géré. |
| `application_database_name` | `gotify` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gotify` | Rôle de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods en continu. |

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 5 — Proxy conscient de l'identité (IAP) {#group-5--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification d'identité Google pour **toutes**
> les requêtes entrantes, y compris les appels d'API d'envoi/réception uniquement par jeton. N'activez IAP que lorsque
> ces appelants peuvent également transporter une identité Google.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Gotify. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (découvre automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `service_url` | URL externe de l'équilibreur de charge GKE. |
| `service_external_ip` | IP externe de l'équilibreur de charge. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `project_id` / `deployment_id` | ID du projet / suffixe de déploiement. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / rôle de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Gotify). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD et dépôt connecté. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt (réexécuter l'apply sur un nouveau cluster inline). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, `min > max` réplicas, `enable_cloudsql_volume` avec `database_type = "NONE"`, un `backup_retention_days` hors de portée, des unités de mémoire de quota non binaires. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | La mise à l'échelle au-delà de 1 sans diffusion externe entraîne la perte de messages pour les clients diffusant depuis d'autres pods (bus de messages en cours de traitement). |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit tous les messages. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans sauvegarde valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `container_port` | `80` | Élevé | Gotify écoute sur le port 80 ; un port non concordant échoue la sonde de démarrage et le pod ne devient jamais prêt. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde au moment de la planification lorsque `database_type` est défini. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; maintenir 1 garantit que le service est toujours accessible. |
| `enable_iap` | uniquement lorsque les appelants portent une identité | Élevé | IAP bloque les appels d'API d'envoi/réception uniquement par jeton. |
| `GOTIFY_DEFAULTUSER_PASS` (auto-généré) | Changer le mot de passe administrateur après la première connexion | Élevé | Le mot de passe de démarrage ne s'applique qu'à la première initialisation ; le laisser inchangé est une exposition permanente des identifiants. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser le pod pendant la maintenance, interrompant les flux en direct. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Gotify
partagée avec la variante Cloud Run est décrite dans
**[Gotify_Common](Gotify_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gotify sur GKE Autopilot](../labs/Gotify_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gotify sur Google Cloud Run](Gotify_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Gotify Common — Configuration d'application partagée](Gotify_Common.md) — la configuration partagée par les deux cibles de déploiement.
