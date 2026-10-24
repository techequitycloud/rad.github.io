---
title: "Kestra sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Kestra sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kestra_GKE.md @ 1665a43e sha256:8c5e5f35b080 -->

# Kestra sur GKE Autopilot {#kestra-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kestra_GKE.png" alt="Kestra sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kestra est une plateforme d'orchestration de données open source (Apache 2.0) pour la
construction, la planification et la surveillance de pipelines ETL/ELT, de jobs par lots et
d'automatisation de workflows grâce à des définitions de flux déclaratives basées sur YAML
et un écosystème de plus de 500 plugins. Ce module déploie Kestra sur **GKE Autopilot** en
mode autonome, sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Kestra et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Kestra sur RAD, et comparaison {#what-kestra-costs-on-rad-and-how-that-compares}

**Le module Kestra sur GKE de RAD coûte environ 136 $ US par mois dans votre propre projet,
plus des frais de module de 175 crédits (18 $ US) une fois par déploiement.** Si vous
n'exécutez des pipelines que selon un calendrier plutôt que de manière continue, consultez
la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre
vos définitions de flux. Kestra est également disponible en tant que module Cloud Run ;
dans votre propre projet, GKE est le choix le moins cher ici car le mode autonome de Cloud
Run nécessite une allocation continue de CPU pour son ordonnanceur, mais dans un projet
géré par RAD, le module du guide Cloud Run est en fait l'option la moins chère en crédits
quotidiens (77 crédits/jour contre 110 ici) — vérifiez les deux avant de choisir.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **136,37 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **110 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US lors d'une recharge unique, moins sur un plan. Dans un projet géré
par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes
les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième
base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 136,37 $ US** |

### Comparaison {#how-it-compares}

- Les offres commerciales de Kestra — Kestra Cloud et Kestra Enterprise Edition — ne
  publient pas de prix mensuel ; les deux pages vous demandent de contacter les ventes,
  nous ne citons donc pas un chiffre que nous n'avons pas pu vérifier.
- L'empreinte de Kestra (2 vCPU, 4 GiB, serveur en mode autonome, plus une base de données
  PostgreSQL) se situe au-dessus d'un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go
  (environ 24 $/mois) et plus proche d'un GCP Compute Engine e2-standard-2 (environ 49
  $/mois) — moins cher en espèces dans les deux cas, mais vous exécutez alors
  l'orchestrateur, PostgreSQL, les sauvegardes et les mises à niveau vous-même, sur un
  système dont d'autres pipelines dépendent pour rester opérationnels.
- RAD vous offre deux façons de l'exécuter qui coûtent différemment pour la même raison :
  le mode autonome de Cloud Run nécessite une allocation continue de CPU pour exécuter son
  propre ordonnanceur, il ne peut donc pas se mettre à l'échelle à zéro comme les autres
  modules, tandis que la facturation des pods de GKE Autopilot est plus faible pour une
  charge de travail toujours active comme celle-ci.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Kestra s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir
— une pause entre les cours, un creux saisonnier, ou simplement ne pas savoir si vous en
aurez besoin le mois prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
de supprimer le projet purement et simplement : la suppression logicielle récupérable de 30
jours de Google. Contrairement à la suppression de Kestra en tant que module unique, cela
ne démolit pas le service Cloud Run/GKE, la base de données Cloud SQL et le réseau un par
un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend,
car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Étant
donné que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à
jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de
crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD ne gère que la
facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le
supprime définitivement — et la restauration est admise comme la création d'un nouveau
projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du palier (100
crédits pour le palier sandbox que la plupart utilisent convient). Google indique que la
plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur
du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement
désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet,
même si le projet lui-même est récupérable pendant 30 jours. L'exportation nocturne de
Kestra couvre sa base de données (définitions de flux, historique d'exécution) ; copiez-la
d'abord si vous voulez un instantané restaurable au-delà des 30 jours du projet.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois la fenêtre de 30 jours ci-dessus passée, la solution
de repli est de supprimer Kestra purement et simplement et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds —
  environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que
  si Kestra resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet
  (environ 2 jours ou plus dans un projet géré par RAD). La base de données représente la
  plus grande partie du coût d'exécution ici, donc la suppression de Kestra seule permet
  d'économiser la totalité de la facture ci-dessus, à moins que quelque chose d'autre dans
  le projet ne la partage.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites dans un bucket
  à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière
  sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si
  vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle
  directement avec le client. Si le portefeuille est faible, la facturation est suspendue
  et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la
  fin, le partenaire transfère le projet et les déploiements deviennent la propriété du
  client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
  KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de
vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Kestra s'exécute en tant que conteneur Java/JVM en mode autonome (serveur, worker et
ordonnanceur dans un seul conteneur). Le déploiement relie un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Java/JVM, 2 vCPU / 4 GiB par défaut, mode autonome à réplica unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — stocke la file d'attente, le référentiel et l'historique d'exécution |
| Stockage d'objets | Cloud Storage | Bucket GCS dédié pour les flux, les exécutions et les artefacts |
| Secrets | Secret Manager | Mot de passe administrateur Kestra auto-généré |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Kestra utilise PostgreSQL pour sa file d'attente
  interne et son référentiel de flux. MySQL n'est pas pris en charge.
- **Le mode autonome exécute tous les composants dans un seul conteneur.** Gardez `max_instance_count = 1`
  pour éviter les états de verrouillage de file d'attente conflictuels entre les réplicas.
- **Le démarrage à froid de la JVM Java est lent.** La sonde de démarrage par défaut
  autorise jusqu'à ~14 minutes (délai initial de 30s + période de 20s × 40 tentatives).
  Gardez `min_instance_count = 1` en production afin que les déclencheurs
  planifiés ne soient jamais manqués pendant les démarrages à froid.
- **Redis n'est pas utilisé.** Kestra utilise PostgreSQL pour la mise en file d'attente en
  mode autonome.
- **L'affinité de session est `ClientIP`.** Requise pour la connexion de
  diffusion de logs persistante de l'interface utilisateur de Kestra — les requêtes du même
  navigateur doivent atteindre le même pod.
- **Le mot de passe administrateur est auto-généré** et stocké dans Secret Manager ; il
  n'est jamais défini en texte clair.
- **Un bucket de stockage GCS est toujours provisionné** pour les flux, les exécutions et
  les artefacts ; son nom est injecté en tant que `KESTRA_STORAGE_GCS_BUCKET`
  automatiquement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kestra {#a-gke-autopilot--the-kestra-workload}

Les pods Kestra sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Par défaut, un seul réplica gère tous les composants
d'orchestration (serveur, worker, ordonnanceur) dans un seul pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  Kestra pour voir les pods, les événements et l'état. Kubernetes Engine → Services et
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Kestra stocke tout l'état du workflow — définitions de flux, historique d'exécution,
déclencheurs, espaces de noms et la file d'attente de tâches interne — dans une instance
gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent via le sidecar **Cloud SQL Auth
Proxy** sur un socket TCP à `127.0.0.1:5432` (aucune IP
publique n'est exposée). Lors du premier déploiement, un job d'initialisation crée la base
de données Kestra, l'utilisateur et accorde les privilèges requis.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné pour le backend de stockage d'artefacts
GCS de Kestra. Toutes les exécutions de flux, les entrées/sorties de tâches et les objets
de stockage internes y sont écrits. Le nom du bucket est injecté dans chaque pod en tant
que `KESTRA_STORAGE_GCS_BUCKET`. Des buckets supplémentaires ou des volumes
GCS Fuse peuvent être montés pour l'accès aux données de flux.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<kestra-storage-bucket>/        # bucket name in Outputs
  # Confirm a GCS Fuse volume is mounted inside a pod (if configured):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe administrateur de Kestra est stocké en tant que secret Secret Manager et
injecté dans les pods au moment de l'exécution ; le texte clair n'apparaît jamais dans la
configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

Le secret du mot de passe administrateur est nommé `<resource_prefix>-admin-password`. Le nom du
secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

La charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. `enable_custom_domain`
par défaut à `true`, provisionnant une passerelle Kubernetes avec un certificat géré par
Google pour les noms d'hôtes dans `application_domains` ; une IP statique est réservée par défaut afin que
l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de
l'adresse IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE
et Cloud SQL sont acheminées vers Cloud Monitoring. Les sondes de santé ciblent le point de
terminaison `/health` de Kestra. Des vérifications de disponibilité
et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Kestra {#3-kestra-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  (`db-init`) utilise `postgres:15-alpine` pour se connecter via le Cloud SQL Auth Proxy et crée de manière
  idempotente la base de données et l'utilisateur Kestra, accorde les privilèges et
  réinitialise le schéma public afin que Flyway puisse appliquer toutes les migrations
  proprement sur une nouvelle instance Cloud SQL. Le job signale au proxy de s'arrêter
  proprement une fois terminé.
- **Migrations Flyway au démarrage.** Kestra exécute ses propres migrations de schéma
  basées sur Flyway à chaque démarrage. Le paramètre `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true`
  empêche les échecs sur Cloud SQL, qui pré-remplit le schéma public avec des objets
  d'extension. La mise à niveau de `application_version` applique
  automatiquement les modifications de schéma.
- **Pont de socket JDBC.** Sur GKE, le sidecar Cloud SQL Auth Proxy écoute déjà sur TCP
  `127.0.0.1:5432`, de sorte que la logique du pont JDBC `entrypoint.sh` est ignorée automatiquement — aucun
  pont `socat` n'est nécessaire ici (contrairement à la variante Cloud Run).
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /health` sur le port 8080. Kestra (Java JVM) a un démarrage lent ; la sonde par défaut
  autorise jusqu'à ~14 minutes avant de déclarer un échec.
- **Affinité de session.** L'interface utilisateur de Kestra diffuse les logs d'exécution
  sur une connexion persistante. `session_affinity = "ClientIP"` achemine toutes les requêtes du même navigateur
  vers le même pod, empêchant les déconnexions de flux de logs.
- **Période de grâce de terminaison.** Définie à 60 secondes (par rapport à la valeur par
  défaut de Kubernetes) pour permettre aux exécutions de tâches en cours de se terminer
  gracieusement avant que le pod ne soit arrêté de force.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est `admin`. Le
  mot de passe est récupéré de Secret Manager (voir §2.D).
- **Déclencheurs planifiés.** L'ordonnanceur interne de Kestra traite les déclencheurs
  définis par le flux (cron, intervalle, webhook). Tant qu'un pod est en cours
  d'exécution, tous les déclencheurs se déclenchent selon le calendrier. La définition de
  `min_instance_count = 0` entraîne des déclencheurs manqués pendant les périodes de démarrage à froid.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Kestra sont listés ; toutes
les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs
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
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kestra` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image Kestra ; incrémenter pour déployer une nouvelle version (par exemple `0.17.0`). |
| `display_name` | `Kestra Data Orchestration` | Nom convivial affiché dans la console et l'interface utilisateur de la plateforme. |
| `description` | `Kestra Data Orchestration - ETL/ELT pipeline and workflow orchestration on GKE Autopilot` | Annotation de description de la charge de travail. |
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU minimum recommandés pour Kestra JVM. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (minimum 2 GiB). |
| `container_port` | `8080` | Port du serveur Kestra/Micronaut. Doit correspondre à `MICRONAUT_SERVER_PORT`. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour que les déclencheurs planifiés ne soient jamais manqués. |
| `max_instance_count` | `1` | Réplicas maximum. Garder à 1 pour le mode autonome afin d'éviter les conflits de file d'attente. |
| `timeout_seconds` | `300` | Durée maximale de la requête en secondes (0–3600). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket TCP à PostgreSQL. |
| `cloud_sql_proxy_version` | `2-alpine` | Tag d'image du sidecar Cloud SQL Auth Proxy. Épingler à un digest pour des déploiements immuables. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Kestra dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM — permet aux exécutions en cours de se terminer. |
| `deployment_timeout` | `1800` | Secondes maximales pendant lesquelles Terraform attend la fin du déploiement (grande image Java). |

`container_image_source`, `container_image`, `container_build_config`, `container_protocol` et
`container_resources` sont déclarés pour la parité de convention de la Fondation mais ne sont **pas transmis** par
ce module — `Kestra_Common` construit toujours l'image officielle `kestra/kestra` via Cloud Build
(`container_build_config`) et transmet `cpu_limit`/`memory_limit` directement au lieu de
`container_resources`. La définition de l'un d'entre eux n'a aucun effet ; utilisez `cpu_limit`/`memory_limit` ci-dessus
pour dimensionner le pod.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables Kestra de base sont injectées automatiquement ; ne les écrasez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple `{ KESTRA_ENCRYPTION_SECRET = "kestra-enc-key" }`). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret (0–300). |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base de données sans interruption. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour la diffusion de logs de l'interface utilisateur de Kestra. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé ; sinon, Déploiement. |
| `gke_cluster_name` | `""` | Laisser vide pour découvrir automatiquement le cluster géré par Services_GCP. |
| `namespace_name` | `""` | Laisser vide pour générer automatiquement à partir du nom de l'application et de l'ID du locataire. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod pour les règles de pare-feu VPC. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `configure_service_mesh` | `false` | Activer l'injection Istio pour l'espace de noms de l'application. |
| `extra_service_ports` | `[]` | Ports de service supplémentaires pour les charges de travail multiprotocoles. Déclaré mais **non transmis** — n'a aucun effet sur ce module. |

`prereq_gke_subnet_cidr`, `prereq_subnet_cidr_override`, `prereq_gke_pod_cidr_override` et
`prereq_gke_service_cidr_override` contrôlent les prérequis VPC/GKE intégrés créés uniquement lorsqu'aucun
réseau/cluster `Services_GCP` n'existe encore. `prereq_gke_subnet_cidr` est déclaré mais non
référencé ; les trois variables `*_override` sont transmises et n'importent que sur les déploiements
existants en ligne (sans `Services_GCP`), pour éviter de remplacer le cluster lors d'une nouvelle
application.

### Groupe 7 — StatefulSet {#group-7--statefulset}

Pertinent uniquement lorsque `workload_type = "StatefulSet"` ou `stateful_pvc_enabled = true`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer un PVC par pod pour le stockage local des plugins ou les fichiers d'exécution temporaires. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. Immuable après la création — planifier la capacité à l'avance. |
| `stateful_pvc_mount_path` | `/app/storage` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `""` | Kubernetes StorageClass ; vide utilise la valeur par défaut du cluster. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds (valeur par défaut `true` pour Kestra). |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones (pertinent uniquement lorsque `max_instance_count > 1`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai 30s, période 20s, 40 échecs | Sonde de démarrage de l'application — permet jusqu'à ~14 minutes pour le démarrage de la JVM. |
| `liveness_probe` | HTTP `/health`, délai 180s, période 30s, 5 échecs | Sonde de vivacité de l'application. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Fournir une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour les tâches auxiliaires planifiées (par exemple, les sauvegardes). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Kestra. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`. `binauthz_evaluation_mode` est déclaré pour la parité de convention
mais non référencé — seul `enable_binary_authorization` est transmis.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionner un partage Cloud Filestore (NFS) et le monter dans les pods. Utile pour les scripts de flux qui écrivent des fichiers locaux. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume ; écraser lors du montage d'un deuxième partage NFS à côté du premier. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets supplémentaires dans `storage_buckets`. Le bucket de stockage Kestra est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de stockage intégré. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Déclaré pour la parité de convention de la Fondation. **Non référencé** — `main.tf` désactive Redis en dur (`enable_redis = false`) car le mode autonome de Kestra met en file d'attente via PostgreSQL, pas Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `"6379"` / `""` | Également déclaré mais non référencé, pour la même raison. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `kestra` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `kestra` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Transmis à `App_GKE` mais non applicable — Kestra est uniquement PostgreSQL. |

`database_type`, `sql_instance_name`, `sql_instance_base_name`, `application_database_name`,
`application_database_user`, `enable_postgres_extensions`, `postgres_extensions`, et l'ensemble
`db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` /
`db_password_env_var_name` / `db_port_env_var_name` sont tous déclarés pour la parité de convention de la Fondation
mais **non transmis** par ce module — `Kestra_Common` fixe le moteur à
`POSTGRES_15` et injecte uniquement les noms standard `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_PORT`.
La définition de l'un d'entre eux n'a aucun effet.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |
| `backup_file` | `backup.sql` | Déclaré pour la parité de convention. **Non référencé** — `main.tf` transmet `backup_uri` comme source d'importation à la place. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une passerelle Kubernetes avec un certificat SSL pour les noms d'hôtes personnalisés. |
| `application_domains` | `[]` | Noms d'hôtes à servir. Vide avec `enable_custom_domain = true` génère un domaine `nip.io`. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. Recommandé pour la production. |
| `gateway_backend_stage` | `dev` | Étape Cloud Deploy (`dev`/`staging`/`prod`) dont le service est ciblé par la Gateway HTTPRoute. Ignoré lorsque `enable_cloud_deploy = false`. |
| `network_name` | `""` | Déclaré pour la parité de convention de la Fondation. **Non référencé** — la découverte du réseau est gérée en interne via `module.network_discovery`. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Kestra. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Kestra. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket de stockage Kestra). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et référentiel Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (référentiel, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du référentiel GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors de la première application d'un nouveau cluster en ligne. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `db_name` | `kestra` — défini une fois | Critique | Immuable après le premier déploiement ; le modifier connecte Kestra à une base de données vide, entraînant la perte de tous les flux, de l'historique d'exécution, des déclencheurs et des espaces de noms. |
| `application_name` | `kestra` — défini une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP/Kubernetes, entraînant une recréation complète avec perte de données. |
| `KESTRA_BASICAUTH_ENABLED` (injecté `true`) | laisser tel quel | Critique | Le fait de le remplacer par `false` expose l'interface utilisateur et l'API REST complètes de Kestra sans authentification. Ne le désactiver que derrière un proxy d'authentification de confiance (IAP, Cloud Armor). |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `max_instance_count` | `1` | Élevé | Kestra Community Edition utilise le verrouillage de la file d'attente PostgreSQL — plusieurs réplicas entraînent une double affectation des tâches et des conflits d'exécution. |
| `min_instance_count` | `1` | Élevé | Le fait de le définir à `0` entraîne le manquement des déclencheurs planifiés pendant les périodes de démarrage à froid. Le démarrage de la JVM Kestra peut prendre plusieurs minutes. |
| `memory_limit` | `4Gi` | Élevé | Des valeurs inférieures à 2 Gio entraînent des erreurs OutOfMemory JVM sous une charge d'exécution concurrente. |
| `enable_cloudsql_volume` | `true` | Élevé | Requis pour la connectivité PostgreSQL ; bloqué au moment de la planification lorsque `database_type != "NONE"`. |
| `KESTRA_QUEUE_TYPE` / `KESTRA_REPOSITORY_TYPE` (injecté `postgres`) | laisser tel quel | Élevé | Seul PostgreSQL est provisionné ; la substitution par un type de backend non pris en charge entraîne un échec au démarrage. |
| `KESTRA_STORAGE_TYPE` (injecté `gcs`) | laisser tel quel | Élevé | Le fait de le changer en `local` entraîne l'écriture de tous les artefacts d'exécution dans le stockage éphémère du pod et leur perte au redémarrage. |
| `startup_probe` seuil d'échec | 40 (par défaut) | Élevé | La réduction en dessous de ~10 entraîne des redémarrages prématurés du pod lors de démarrages lents de la JVM avant que Kestra n'ait fini de charger tous les flux. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance de session, les connexions de streaming de logs de l'interface utilisateur Kestra se déconnectent lorsqu'elles sont acheminées vers un pod différent. |
| `termination_grace_period_seconds` | `60` | Moyen | Des valeurs inférieures à 30 s interrompent les exécutions de tâches en cours de route. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation du PDB permet à GKE d'expulser le pod Kestra pendant la maintenance du nœud, interrompant toutes les exécutions en cours. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont traités comme des octets par Kubernetes et bloquent toute planification dans l'espace de noms. |
| `enable_iap` / `enable_cloud_armor` | activer pour les interfaces d'administration | Moyen | L'interface utilisateur et l'API Kestra sont autrement accessibles publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour les exigences de rétention de conformité. |
| `organization_id` | définir lors de l'utilisation de VPC-SC | Moyen | Si vide, les contrôles de service VPC sont ignorés silencieusement. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes,
et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application
spécifique à Kestra partagée avec la variante Cloud Run est décrite dans
**[Kestra_Common](Kestra_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Kestra sur GKE Autopilot](../labs/Kestra_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Kestra sur Google Cloud Run](Kestra_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Kestra Common — Configuration d'application partagée](Kestra_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Apache Superset sur GKE Autopilot](Superset_GKE.md), [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Analytics Warehouse**.
