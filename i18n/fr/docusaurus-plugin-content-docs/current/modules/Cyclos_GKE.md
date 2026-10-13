---
title: "Cyclos sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Cyclos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Cyclos_GKE.md @ e69407af sha256:0859f4aba15d -->

# Cyclos sur GKE Autopilot {#cyclos-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_GKE.png" alt="Cyclos sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cyclos est une plateforme bancaire et de paiement riche en fonctionnalités, utilisée par
les institutions de microfinance, les coopératives de crédit et les réseaux de monnaies
complémentaires. Ce module déploie Cyclos sur **GKE Autopilot** sur la base de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Cyclos et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Cyclos sur RAD, et comment cela se compare {#what-cyclos-costs-on-rad-and-how-that-compares}

**Le module Cyclos sur GKE Autopilot de RAD coûte environ 136,37 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 175 crédits (17,50 $ US).** Cyclos est une plateforme bancaire et de paiement utilisée par les institutions de microfinance, les coopératives de crédit et les réseaux de monnaies communautaires. Pour le coût le plus bas, le [guide Cloud Run](Cyclos_CloudRun.md) exécute le même Cyclos pour environ 76,75 $ US par mois ; choisissez GKE ici seulement si Cyclos doit rester opérationnel en continu, s'adapter à travers les pods, ou fonctionner aux côtés d'autres charges de travail Kubernetes.

Si Cyclos n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 136,37 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **136,37 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **110 crédits par jour**, soit environ 3300 par mois (environ 330 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 136,37 $ US** |

### Comment cela se compare {#how-it-compares}

- L'exécuter vous-même et un VPS exécutant Cyclos et PostgreSQL vous-même — une tâche plus importante ici que pour la plupart des applications, étant donné la conformité et la disponibilité qu'une plateforme bancaire exige — coûte moins cher en espèces : dimensionné à environ 2 vCPU/4 Gio, un VPS comparable (Hetzner ou DigitalOcean) coûte environ 24 à 48 $ par mois, ou une VM GCP `e2-standard-2`-class environ 49 $ — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, ainsi que la possibilité de mettre Cyclos en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).
- La majeure partie du coût d'exécution ci-dessus est la base de données PostgreSQL gérée (et, le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison avec un VPS nu doit exécuter et sauvegarder à la main.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Cyclos s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux aux instances de Cyclos dont vous n'avez besoin qu'occasionnellement que de les exécuter en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un seul module, cela ne détruit pas les ressources Cloud SQL ou GKE Autopilot une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne Cyclos typique, contre les 180 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 136,37 $ US.** Déployez Cyclos, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Cyclos et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si Cyclos devait rester inutilisé pendant environ 4 jours ou plus dans votre propre projet (4,55 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (110 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données.** Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Cyclos alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Cyclos fonctionne comme une charge de travail web Java/Tomcat. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Java/Tomcat, 2 vCPU / 4 Gio recommandés, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Cyclos ne prend pas en charge MySQL ou SQL Server |
| Stockage d'objets | Cloud Storage | Un bucket de stockage de fichiers dédié (`<prefix>-cyclos-storage`) pour les fichiers et médias téléchargés |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré ; `ROOT_PASSWORD` pour la configuration de l'extension superutilisateur |
| Ingress | Cloud Load Balancing | LoadBalancer externe, nom de domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Cyclos nécessite six extensions PostgreSQL
  spécifiques (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`). MySQL et SQL
  Server ne sont pas pris en charge.
- **Les extensions PostgreSQL sont installées automatiquement** par le job `db-init` avant le
  démarrage de Cyclos — vous n'avez pas besoin de les activer manuellement.
- **Le stockage de fichiers GCS est obligatoire.** Cyclos utilise Google Cloud Storage
  comme gestionnaire de contenu de fichiers (`cyclos.storedFileContentManager = gcs`). NFS est désactivé pour le
  conteneur Cyclos ; le nom du bucket GCS est injecté automatiquement.
- **`max_instance_count` est défini par défaut sur 1.** Cyclos Community Edition nécessite une
  configuration Hazelcast pour une mise à l'échelle horizontale. N'augmentez qu'après avoir
  configuré le clustering.
- **Gestion du schéma au démarrage.** Cyclos crée et migre son propre schéma PostgreSQL
  au premier démarrage (`cyclos.db.managed = true`). Le démarrage du premier déploiement prend 2 à 5
  minutes pendant la création des extensions et l'initialisation du schéma.
- **Les sondes de santé ciblent `/api`.** Le point de terminaison `/api` renvoie
  HTTP 200 uniquement une fois que Cyclos est entièrement initialisé, ce qui en fait le
  chemin de sonde le plus fiable.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cyclos {#a-gke-autopilot--the-cyclos-workload}

Les pods Cyclos sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
les nombres de réplicas minimum et maximum.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  Cyclos pour voir les pods, les révisions et les événements. Kubernetes Engine → Services
  et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type
de charge de travail (Déploiement vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cyclos stocke toutes les données d'application (comptes, transactions, membres) dans une
instance Cloud SQL pour PostgreSQL 15 gérée. Lors du premier déploiement, un job
d'initialisation se connecte en tant que superutilisateur `postgres`, crée la base de
données et l'utilisateur de l'application, et installe les six extensions PostgreSQL
requises. Les démarrages ultérieurs utilisent l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
  # Inside psql — confirm required extensions are installed:
  # \dx
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
voir [App_GKE](App_GKE.md).

### C. Cloud Storage — gestionnaire de contenu de fichiers {#c-cloud-storage--file-content-manager}

Cyclos stocke tous les fichiers téléchargés, les photos de profil et les pièces jointes
aux transactions dans un bucket Cloud Storage dédié provisionné dans le cadre du
déploiement. Le nom du bucket est dérivé du préfixe de ressource du déploiement et
injecté automatiquement en tant que `cyclos.storedFileContentManager.bucketName`. Le compte de service de la charge de
travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets → recherchez `<prefix>-cyclos-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos-storage"
  gcloud storage ls gs://<cyclos-storage-bucket>/
  # Confirm the bucket env var is injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    sh -c 'echo $cyclos__storedFileContentManager__bucketName'
  ```

Voir [App_GKE](App_GKE.md) pour les options de montage GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données Cyclos et le superutilisateur PostgreSQL
(`ROOT_PASSWORD`) sont stockés en tant que secrets Secret Manager et injectés dans les pods
au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration. Le
job `db-init` utilise `ROOT_PASSWORD` pour installer les extensions ; Cyclos utilise
`DB_PASSWORD` pour se connecter au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de
Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé,
et une adresse IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et
les adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE
et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des
stratégies d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cyclos {#3-cyclos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` s'exécute
  en tant que superutilisateur PostgreSQL et de manière idempotente : il crée l'utilisateur
  de base de données `cyclos`, crée la base de données de l'application, installe les six
  extensions requises (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`,
  `unaccent`) et accorde les privilèges nécessaires. Il peut être réexécuté en toute
  sécurité.
- **Gestion du schéma au démarrage.** Cyclos crée et fait évoluer son propre schéma
  PostgreSQL au démarrage (`cyclos.db.managed = true`). Le démarrage du premier déploiement prend 2 à 5
  minutes pendant la construction du schéma. Les démarrages ultérieurs sont plus rapides
  mais valident toujours le schéma.
- **Dimensionnement du tas JVM.** Définissez la variable d'environnement `CYCLOS_OPTIONS` pour
  limiter l'utilisation du tas JVM — par exemple `{ CYCLOS_OPTIONS = "-Xmx3g" }` pour une limite de mémoire de
  4 Gio. Sans cela, la JVM peut consommer toute la mémoire disponible du conteneur et être
  terminée par OOMKilled.

  ```bash
  # Confirm CYCLOS_OPTIONS is set on the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CYCLOS_OPTIONS
  ```
- **Chemin de la sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `/api`, qui renvoie HTTP 200 uniquement une fois que Cyclos est entièrement
  initialisé et que le schéma est appliqué. L'utilisation d'un chemin différent (tel que
  `/`) entraîne une redirection 302 et la sonde ne passe jamais.
- **Valeur par défaut d'instance unique.** Cyclos Community Edition utilise par défaut un
  seul réplica (`max_instance_count = 1`). L'augmentation du nombre sans configuration de clustering
  Hazelcast entraîne un traitement des transactions non atomique et une corruption
  potentielle des données.
- **Clustering Hazelcast (facultatif).** Pour les déploiements multi-réplicas, définissez
  `workload_type = "StatefulSet"` et configurez la découverte Hazelcast via `environment_variables`. Le
  `hazelcast.xml` fourni utilise la découverte DNS Kubernetes via la variable
  d'environnement `CLUSTER_K8S_DNS`.
- **Livraison d'e-mails.** Cyclos envoie des e-mails transactionnels (notifications,
  réinitialisations de mot de passe) via SMTP. Configurez les paramètres SMTP via
  `environment_variables` :

  ```bash
  environment_variables = {
    SMTP_HOST  = "smtp.sendgrid.net"
    SMTP_PORT  = "587"
    SMTP_USER  = "apikey"
    SMTP_SSL   = "true"
    EMAIL_FROM = "noreply@yourbank.example.com"
  }
  ```
  Utilisez `secret_environment_variables` pour `SMTP_PASSWORD`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Cyclos sont listés ;
chaque autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement et ses
valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cyclos` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `Cyclos Community Edition` | Nom convivial affiché dans les annotations de charge de travail GKE et l'interface utilisateur de la plateforme. |
| `application_description` | `Cyclos Community Edition on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `4.16.17` | Tag de version de l'image Cyclos. Incrémenter pour déclencher un nouveau pull d'image et un nouveau déploiement. |
| `display_name` | `Cyclos Community Edition` | Nom transmis à Cyclos_Common pour l'objet de configuration de l'application. |
| `description` | `Cyclos Banking System on GKE` | Description transmise à Cyclos_Common. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Spécification complète des ressources. **Remplacez par au moins `"2000m"` CPU et `"2Gi"` mémoire.** `"4Gi"` recommandé pour la production. |
| `cpu_limit` | `2000m` | Variable de commodité transmise à Cyclos_Common. Remplacée par `container_resources` en pratique. |
| `memory_limit` | `4Gi` | Variable de commodité transmise à Cyclos_Common. Remplacée par `container_resources` en pratique. |
| `min_instance_count` | `1` | Réplicas minimum. Gardez ≥ 1 pour éviter les démarrages à froid lents de la JVM. |
| `max_instance_count` | `1` | Réplicas maximum. Gardez `1` sauf si le clustering Hazelcast est configuré. |
| `container_port` | `8080` | Cyclos/Tomcat écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. Cyclos utilise par défaut le TCP direct — n'activez que si cela est vérifié comme nécessaire. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. SMTP et `CYCLOS_OPTIONS` sont configurés ici. Les variables Cyclos de base sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant pour une gestion cohérente des sessions. |
| `workload_type` | `null` | Sélectionne automatiquement le déploiement. Définissez `StatefulSet` uniquement avec le clustering Hazelcast. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; conservés pour la compatibilité des règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les PVC par pod. Pour Cyclos, pertinent uniquement avec le stockage de fichiers local (par défaut, GCS). |
| `stateful_pvc_size` | `10Gi` | Stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |
| `stateful_headless_service` | `null` | Crée un service sans tête pour un DNS stable — requis pour Hazelcast. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID fsGroup pour la propriété du volume. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limite le nombre de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau de nœuds. N'activez que lorsque `min_instance_count > 1`. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations. |
| `enable_topology_spread` | `false` | Répartit les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api`, délai de 90s, période de 60s, 5 échecs | Sonde de démarrage spécifique à Cyclos. Augmentez `failure_threshold` à `10` pour la création de schéma au premier déploiement. |
| `liveness_probe` | HTTP `/api`, délai de 120s, période de 60s, 3 échecs | Sonde de vivacité spécifique à Cyclos. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (crée les extensions, l'utilisateur et la base de données). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Cyclos. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas utilisé par le conteneur Cyclos (GCS est le stockage de fichiers). Définissez `true` uniquement si vous avez besoin de NFS provisionné pour d'autres jobs. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données supplémentaire. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires (le bucket primaire `cyclos-storage` est provisionné automatiquement). |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Moteur Cloud SQL. Cyclos nécessite PostgreSQL. Ne pas changer pour MySQL ou `NONE`. |
| `db_name` | `cyclos` | Nom de la base de données PostgreSQL transmis au job `db-init` de `Cyclos_Common` et injecté dans la configuration de l'application. **Immuable après le premier déploiement.** |
| `db_user` | `cyclos` | Utilisateur de l'application transmis à `Cyclos_Common`. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

Note : `application_database_name` / `application_database_user` (valeurs par défaut `gkeappdb` /
`gkeappuser`) sont une paire distincte transmise au provisionnement de base de données de la
fondation `App_GKE`. La base de données/utilisateur réelle de Cyclos (telle que connectée
par l'application) est pilotée par `db_name` / `db_user` ci-dessus, provisionnée par le
job `db-init` de `Cyclos_Common` — laissez la paire `application_database_*` à ses valeurs par défaut.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définissez `false` après une importation réussie. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy sensible à l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige la connexion Google devant Cyclos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Cyclos. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
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
| `database_type` | `POSTGRES` ou `POSTGRES_15` | Critique | Cyclos nécessite PostgreSQL. MySQL ou `NONE` empêche complètement le démarrage. |
| `db_name` / `db_user` | défini une fois (`cyclos` / `cyclos`) | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données financières. |
| `max_instance_count` | `1` (par défaut) | Critique | Plus de 1 sans clustering Hazelcast entraîne des transactions non atomiques et une corruption potentielle des données. |
| `application_name` | `cyclos` (ne pas modifier) | Critique | Intégré dans l'espace de noms GKE, le dépôt Artifact Registry, les secrets Secret Manager et le nom du bucket GCS. Toute modification orpheline toutes les ressources. |
| `cyclos.storedFileContentManager` variable d'environnement | `gcs` (codé en dur) | Critique | La surcharge à `local` écrit les fichiers dans le stockage éphémère du pod ; toutes les téléversements sont perdus au redémarrage. |
| `memory_limit` (dans `container_resources`) | `≥ 2Gi` (`4Gi` recommandé) | Critique | La JVM lève `OutOfMemoryError` ; le pod est OOMKilled (code de sortie 137). |
| `CYCLOS_OPTIONS` variable d'environnement | `-Xmx3g` pour une limite de 4 GiB | Critique | Pas de `-Xmx` : la JVM se développe pour consommer toute la mémoire du conteneur ; le pod est OOMKilled sous charge. |
| `startup_probe.path` | `/api` | Critique | Un chemin incorrect signifie que la sonde ne voit jamais HTTP 200 ; GKE tue le pod avant qu'il n'accepte le trafic. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `enable_backup_import` | `false` après restauration | Élevé | Laisser `true` relance la restauration à chaque apply, écrasant les données financières en direct. |
| `container_resources` cpu | `≥ 2000m` | Élevé | Le GC Java et le démarrage de Cyclos sont liés au CPU ; trop peu de CPU entraîne des échecs de sonde de démarrage. |
| `startup_probe.failure_threshold` | `≥ 5` (augmenter à `10` pour le premier déploiement) | Élevé | Trop faible : la création de l'extension `db-init` prend 1 à 3 minutes ; le pod est tué avant que le schéma ne soit prêt. |
| `min_instance_count` | `1` | Élevé | `0` provoque des démarrages à froid de la JVM de 45 à 120 s ; les transactions bancaires expirent en attendant le réchauffement. |
| `enable_pod_disruption_budget` | `false` sauf si `min_instance_count > 1` | Élevé | Un PDB avec `1/1` bloque les vidanges de nœuds ; les mises à niveau Autopilot s'arrêtent définitivement. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'interface d'administration | Moyen | L'interface d'administration de Cyclos est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des enregistrements financiers. |

---

Pour le comportement de la fondation référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Cyclos partagée avec la variante Cloud Run est
décrite dans **[Cyclos_Common](Cyclos_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Cyclos sur GKE Autopilot](../labs/Cyclos_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cyclos sur Google Cloud Run](Cyclos_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Cyclos Common — Configuration d'application partagée](Cyclos_Common.md) — la configuration partagée par les deux cibles de déploiement.
