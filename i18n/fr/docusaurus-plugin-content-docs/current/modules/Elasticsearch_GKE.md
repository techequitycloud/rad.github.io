---
title: "Elasticsearch sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Elasticsearch sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Elasticsearch_GKE.md @ 1665a43e sha256:47a609338e7e -->

# Elasticsearch sur GKE Autopilot {#elasticsearch-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Elasticsearch_GKE.png" alt="Elasticsearch sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Elasticsearch est un moteur de recherche et d'analyse distribué open source basé sur Apache
Lucene. Ce module déploie un **cluster Elasticsearch à nœud unique** sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Elasticsearch utilise et sur la manière de les explorer et de les exploiter
depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à toutes
les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Elasticsearch sur RAD, et comment cela se compare {#what-elasticsearch-costs-on-rad-and-how-that-compares}

**Le module Elasticsearch sur GKE Autopilot de RAD coûte environ 136,37 $ US par mois.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau vous-même. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 136,37 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **136,37 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **105 crédits par jour**, soit environ 3 150 par mois (environ 315 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 136,37 $ US** |

_Note : la vue d'ensemble de ce module ci-dessous indique qu'il est entièrement autonome, sans Cloud SQL ni bucket Cloud Storage. Les lignes Cloud SQL et Cloud Storage ci-dessus semblent être héritées du modèle de coût partagé plutôt que de dépenses réelles pour ce module — signalées ici pour vérification par rapport au Terraform en direct plutôt que discrètement supprimées._

### Comment cela se compare {#how-it-compares}

- Elastic (l'entreprise derrière Elasticsearch) vend Elastic Cloud sur une base de paiement à l'usage, basée sur les ressources, sans prix public fixe à citer ici. La comparaison honnête est donc un VPS nu : une instance Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go coûte environ 24 $ US par mois, ou une instance GCP Compute Engine e2-standard-2 environ 49 $ US — proche des 2 vCPU/4 Gio par défaut de ce module — plus votre propre temps pour exécuter et patcher Elasticsearch, l'optimiser pour la JVM et gérer son stockage vous-même.
- Un nœud autogéré unique n'a pas de prise de clichés automatisée prête à l'emploi ; le module de RAD l'exécute comme un GKE StatefulSet avec un volume persistant, qui survit à un redémarrage de pod, mais vous devez toujours exporter des clichés pour tout ce que vous ne pouvez pas vous permettre de perdre (voir **Payez uniquement pendant que vous l'utilisez**, ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Elasticsearch s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien à Elasticsearch dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité
saisonnière — bien mieux que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un seul module, cela ne détruit pas le pod GKE ou son disque persistant un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille d'Elasticsearch, contre
  les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 136,37 $ US.** Déployez Elasticsearch, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Elasticsearch était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démo).
  Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : l'index lui-même.** Elasticsearch conserve ses données sur un Persistent Disk, et non une
  base de données avec sa propre sauvegarde automatisée — rien ici ne copie ce disque pour vous. Exportez un
  cliché avant de supprimer si vous voulez récupérer vos index, même pour une pause de 30 jours.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits
  (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Elasticsearch. La suppression permet d'économiser de l'argent une fois qu'Elasticsearch resterait inutilisé
  pendant environ **3 jours ou plus** dans votre propre projet (environ 4,55 $ US par jour), ou environ
  **1 jour ou plus** dans un projet géré par RAD (105 crédits par jour).
- **Supprimez tout ce qu'Elasticsearch utilise.** Le seul coût d'exécution d'Elasticsearch est son propre pod GKE et son disque persistant — il n'y a pas d'instance Cloud SQL distincte malgré ce qu'un modèle de coût générique pourrait lister (voir la note sur le tableau des coûts d'exécution ci-dessous) — donc sa suppression arrête presque tous ses propres coûts immédiatement.
- **Conservez d'abord vos données.** Les données indexées d'Elasticsearch résident entièrement sur son propre volume Persistent Disk, qui est supprimé avec le déploiement. Exportez un cliché d'index vers un bucket Cloud Storage en dehors du projet avant de supprimer si vous souhaitez le conserver — les PersistentVolumes de GKE ne sont pas sauvegardés automatiquement.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez les
  paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose
  d'Elasticsearch dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Elasticsearch pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
Frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Elasticsearch s'exécute en tant que charge de travail StatefulSet. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Elasticsearch StatefulSet, 2 vCPU / 4 Gio par défaut |
| Stockage persistant | Persistent Disk (SSD) | PVC de 30 Gio à `/usr/share/elasticsearch/data`, survit aux redémarrages de pod |
| Secrets | Secret Manager | Secrets optionnels injectés en tant que variables d'environnement |
| Ingress | Cloud Load Balancing | Service LoadBalancer sur le port 9200 pour l'accès inter-espaces de noms |
| Registre d'images | Artifact Registry | Image Elasticsearch mise en miroir depuis le registre d'Elastic |

**Pas de Cloud SQL, pas de Redis, pas de buckets GCS** — Elasticsearch est entièrement autonome ;
toutes les données résident dans son PVC.

**Paramètres par défaut judicieux à connaître d'emblée :**

- **StatefulSet avec PVC est le type de charge de travail requis.** Le paramètre `stateful_pvc_enabled =
  true` (qui sélectionne automatiquement StatefulSet) donne à chaque pod un volume SSD dédié qui
  survit aux redémarrages, aux mises à jour progressives et aux évictions de nœuds. Perdre le PVC signifie perdre toutes
  les données indexées.
- **Mode nœud unique** (`discovery.type = single-node`) est appliqué au moment de la planification —
  `max_instance_count` est fixé à `1`. L'augmenter sans changer le type de découverte
  crée des clusters à nœud unique isolés, et non un cluster distribué.
- **La mémoire heap de la JVM doit être au maximum la moitié de `memory_limit`.** Elasticsearch a besoin de l'autre moitié
  pour le cache de pages du système d'exploitation et la surcharge de la JVM. La violation de ce rapport déclenche des OOM kills sous charge de recherche.
  Une précondition au moment de la planification applique cette règle.
- **`cluster_name` est immuable après le premier index.** Le modifier après l'indexation des documents
  entraîne le traitement des données PVC existantes comme étrangères par Elasticsearch et leur rejet.
  Choisissez un nom significatif avant le premier déploiement.
- **La période de grâce de terminaison est de 120 secondes** pour permettre à Elasticsearch de vider les écritures de segments en mémoire
  sur le disque proprement avant que le pod ne soit supprimé de force.
- **Ce module est la dépendance requise pour `RAGFlow_GKE`.** Après le déploiement, la
  sortie `elasticsearch_endpoint` (`http://<external-ip>:9200`) est transmise à la variable
  `elasticsearch_hosts` de RAGFlow.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Elasticsearch {#a-gke-autopilot--the-elasticsearch-workload}

Elasticsearch s'exécute en tant que StatefulSet Kubernetes sur GKE Autopilot. Autopilot facture
le CPU et la mémoire que le pod demande réellement. Un PodDisruptionBudget maintient le pod
disponible pendant les mises à niveau de nœuds.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez le StatefulSet Elasticsearch pour
  voir l'état du pod, les événements et l'attachement du PVC. Kubernetes Engine → Services et Ingress
  affiche l'adresse IP externe du LoadBalancer sur le port 9200.
- **CLI :**
  ```bash
  kubectl get statefulsets,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # confirm PVC is Bound
  ```

Voir [App_GKE](App_GKE.md) pour la mise à l'échelle d'Autopilot, le PDB et le cycle de vie du StatefulSet.

### B. Persistent Disk — stockage d'index {#b-persistent-disk--index-storage}

Tous les index Elasticsearch et les fichiers de shards résident sur un PersistentVolumeClaim
soutenu par un **Persistent Disk (SSD)**. Le PVC est provisionné par la StorageClass
`standard-rwo` (ou `premium-rwo`) et monté à `/usr/share/elasticsearch/data`.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims pour voir la taille et
  l'état de liaison. Compute Engine → Disques affiche le disque sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  # Check disk usage inside the pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /usr/share/elasticsearch/data
  ```

Surveillez les seuils de remplissage du disque — Elasticsearch passe les index en lecture seule à 95 %
de capacité par défaut. Planifiez la taille du PVC avec une marge de 50 à 100 % au-dessus du volume de données attendu.

### C. Point de terminaison du service Elasticsearch {#c-elasticsearch-service-endpoint}

L'API HTTP d'Elasticsearch est exposée sur le port 9200 via un service Kubernetes LoadBalancer.
Cette adresse IP externe est la sortie `elasticsearch_endpoint` et est transmise directement
à RAGFlow et aux autres consommateurs.

- **Console :** Kubernetes Engine → Services et Ingress → sélectionnez le service pour
  l'adresse IP externe et le mappage de port.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Verify the cluster is up and healthy:
  curl http://<elasticsearch-endpoint>/_cluster/health?pretty
  curl http://<elasticsearch-endpoint>/_cat/indices?v
  # List all indexes:
  curl http://<elasticsearch-endpoint>/_cat/indices?h=index,docs.count,store.size
  ```

### D. Secret Manager {#d-secret-manager}

Les secrets optionnels (tels que les identifiants personnalisés ou les clés API) sont stockés dans Secret Manager
et injectés en tant que variables d'environnement au démarrage du pod.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Artifact Registry — image de conteneur {#e-artifact-registry--container-image}

L'image officielle `docker.elastic.co/elasticsearch/elasticsearch:<version>` est
mise en miroir dans Artifact Registry avant chaque déploiement (lorsque `enable_image_mirroring =
true`). Cela évite les limites de débit du registre Elastic et maintient les images dans votre périmètre VPC.

- **Console :** Artifact Registry → sélectionnez le dépôt pour les tags, les digests et
  les résultats d'analyse de vulnérabilité.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT"
  ```

### F. Réseau et Ingress {#f-networking--ingress}

Le service LoadBalancer expose Elasticsearch sur le port 9200. Une adresse IP externe statique peut
être réservée. Cloud Armor peut être superposé au backend Ingress pour la protection WAF (bien que
pour Elasticsearch, les restrictions au niveau du réseau — règles de pare-feu et `enable_network_segmentation`
— soient généralement préférées aux règles WAF orientées navigateur).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, les adresses IP statiques et les détails de Cloud
Armor.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs stdout/stderr du pod (logs Elasticsearch) sont envoyés à Cloud Logging. Les métriques GKE sont envoyées à Cloud
Monitoring. Des tests de disponibilité optionnels peuvent sonder `/_cluster/health`.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Elasticsearch {#3-elasticsearch-application-behaviour}

- **Opération à nœud unique.** Le module déploie Elasticsearch avec
  `discovery.type = single-node`, ce qui désactive la coordination de cluster. C'est le
  mode correct et pris en charge pour un déploiement à un seul pod. N'augmentez pas
  `max_instance_count` au-delà de `1` sans également remplacer `discovery.type` — l'exécution de
  plusieurs clusters à nœud unique en parallèle entraîne une isolation des données, et non une distribution.
- **Stockage d'index persistant.** Toutes les données résident dans le PVC à
  `/usr/share/elasticsearch/data`. Le chemin est appliqué — modifier `stateful_pvc_mount_path`
  sans mettre à jour le paramètre `path.data` entraîne l'écriture des données dans la couche
  de conteneur éphémère et leur perte silencieuse lors du prochain redémarrage du pod.
- **Dimensionnement de la mémoire heap de la JVM.** `ES_JAVA_OPTS` est automatiquement défini à `-Xms<heap> -Xmx<heap>`
  à partir de la variable `es_java_heap`. La mémoire heap d'Elasticsearch ne doit pas dépasser la moitié de
  `memory_limit` — le reste est consommé par le cache de segments hors-heap de Lucene, le metaspace de la JVM
  et la mémoire native. Une précondition au moment de la planification applique cette règle.
- **mmap désactivé.** GKE Autopilot n'autorise pas les `initContainers` privilégiés à augmenter
  `vm.max_map_count`. En conséquence, le module définit `node.store.allow_mmap = false`, ce qui
  empêche les fichiers mappés en mémoire basés sur mmap et entraîne une légère pénalité de lecture séquentielle
  par rapport au mode mmap. C'est une contrainte connue de GKE Autopilot.
- **Les sondes de santé sont codées en dur en TCP, inconditionnellement.** `elasticsearch.tf` définit à la fois
  la sonde de démarrage et la sonde de vivacité à `type = "TCP"` quelle que soit
  `enable_xpack_security` — une simple vérification d'ouverture de port sur 9200, et non une requête HTTP à
  `/_cluster/health`. La sonde de démarrage autorise jusqu'à 60 tentatives avec une période de 10s
  (≈10 minutes au total, en plus d'un délai initial de 30s) pour s'adapter au provisionnement de nœuds froids,
  au tirage d'image et au temps de démarrage de la JVM/récupération de shard ; la sonde de vivacité utilise un
  délai initial de 60s, une période de 30s et un seuil de 3 tentatives. C'est délibéré : une sonde HTTP
  renverrait `401 Unauthorized` une fois la sécurité X-Pack activée, et échouerait
  avant que les propres vérifications de démarrage d'Elasticsearch (implicitement passées une fois le port 9200 ouvert)
  ne soient terminées. **Les variables `startup_probe_config` et `health_check_config` n'ont aucun
  effet sur ce module** — `App_GKE` (`modules.tf`) préfère toujours la sonde codée en dur de l'application
  à la valeur transmise par ces variables, il n'y a donc rien à configurer ou à remplacer ici pour un
  opérateur, y compris lorsque `enable_xpack_security = true`.
- **La sécurité X-Pack est désactivée par défaut.** Avec `enable_xpack_security = false`, le
  point de terminaison HTTP accepte les requêtes non authentifiées. Tout appelant pouvant atteindre le port 9200 peut
  lire, écrire ou supprimer tous les index. Ceci est acceptable pour un cluster accessible uniquement
  au sein du VPC ; activez-le pour les déploiements publics ou multi-locataires.
- **L'authentification X-Pack est entièrement automatisée lorsqu'elle est activée.** La définition de `enable_xpack_security = true`
  déclenche `elasticsearch_auth.tf` pour générer un mot de passe aléatoire, le stocker dans Secret
  Manager sous le nom `secret-<prefix>-<application_name>-elastic-password`, et l'injecter dans
  le conteneur sous le nom `ELASTIC_PASSWORD` — l'image officielle amorce le superutilisateur `elastic`
  avec cette valeur au premier démarrage d'un répertoire de données vide. Aucune configuration par l'opérateur
  n'est requise. Le nom d'utilisateur (toujours `elastic`) et l'ID secret sont exposés via les
  sorties `elasticsearch_username` et `elasticsearch_password_secret_id` (voir
  [Sorties](#5-outputs)) — récupérez le mot de passe avec
  `gcloud secrets versions access latest --secret=<elasticsearch_password_secret_id>`.
  Les modules consommateurs tels que RAGFlow ou Zammad peuvent référencer le même ID secret
  de manière déterministe pour s'authentifier auprès de ce cluster.
- **Le nom du cluster est intégré à l'identité du nœud.** La modification de `cluster_name` après la création du premier
  index entraîne le traitement des données PVC existantes comme étrangères par Elasticsearch et l'échec du démarrage.
  Un renommage nécessite la destruction du PVC et la réindexation de tous les documents.
- **Aucun job d'initialisation n'est requis.** Elasticsearch s'amorce lui-même au premier
  démarrage. Il n'y a pas d'étape de création de base de données ou d'utilisateur.
- **Période de grâce de terminaison.** Kubernetes attend 120 secondes après l'envoi de SIGTERM
  avant de tuer de force le pod. Cela permet à Elasticsearch de vider les entrées du translog
  et de fermer les shards proprement, évitant une récupération potentiellement lente du translog lors
  du prochain démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Elasticsearch sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `elasticsearch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Elasticsearch` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `8.13.4` | Tag de version de l'image Elasticsearch ; incrémenter pour déployer une nouvelle version. |
| `cluster_name` | `ragflow` | Définit `cluster.name` dans Elasticsearch. **Immuable après le premier index** — le renommage nécessite la destruction complète du PVC et la réindexation. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner l'espace de noms et IAM sans déployer la charge de travail. |
| `container_image_source` | `prebuilt` | Toujours `prebuilt` — Elasticsearch utilise l'image officielle d'Elastic. |
| `container_image` | `""` | Remplace l'URI de l'image ; laisser vide pour utiliser l'image officielle d'Elasticsearch. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image du registre d'Elastic dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Maintenir à `1` pour le mode nœud unique. |
| `max_instance_count` | `1` | **Fixé à `1`** — appliqué au moment de la planification. L'augmentation sans remplacement de `discovery.type` crée des clusters isolés. |
| `container_port` | `9200` | Port de l'API HTTP d'Elasticsearch. |
| `cpu_limit` | `2000m` | CPU par pod. 2 vCPU est la base recommandée ; passer à `4000m` pour une indexation intensive. |
| `memory_limit` | `4Gi` | Mémoire par pod. **Doit être au moins 2× `es_java_heap`.** |
| `es_java_heap` | `512m` | Mémoire heap de la JVM (`-Xms` et `-Xmx`). **Doit être ≤ la moitié de `memory_limit`** — appliqué au moment de la planification. |
| `enable_xpack_security` | `false` | Activer la sécurité X-Pack (authentification). Lorsque `false`, le port 9200 n'est pas authentifié. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `timeout_seconds` | `300` | Délai d'expiration du backend de l'équilibreur de charge (0 à 3600 secondes). |
| `termination_grace_period_seconds` | `120` | Secondes pendant lesquelles Kubernetes attend après SIGTERM pour le vidage des segments avant de tuer de force. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend la fin du déploiement du StatefulSet. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires fusionnées dans le conteneur **après** les paramètres Elasticsearch auto-injectés ; peut remplacer toute valeur auto-définie (par exemple, `discovery.type`, `ES_JAVA_OPTS`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Cadence de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; généré automatiquement s'il est vide. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | `LoadBalancer` est requis pour l'accès inter-espaces de noms depuis RAGFlow. Utilisez `ClusterIP` uniquement lorsque les deux charges de travail partagent le même espace de noms. |
| `session_affinity` | `None` | Affinité de session. `None` est correct pour Elasticsearch (HTTP sans état). |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy pour restreindre l'entrée/sortie. |
| `termination_grace_period_seconds` | `120` | Également affiché dans le groupe 4 ; défini une fois ici. |
| `deployment_timeout` | `1800` | Également affiché dans le groupe 4 ; défini une fois ici. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod GKE pour les règles de pare-feu. |

### Groupe 7 — StatefulSet et persistance {#group-7--statefulset--persistence}

La persistance des données est essentielle — toutes les données d'index Elasticsearch résident dans le PVC.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Définissez `true` pour tous les déploiements** — sélectionne automatiquement StatefulSet. Sans PVC, tous les index sont perdus à chaque redémarrage de pod. |
| `stateful_pvc_size` | `30Gi` | Taille du PVC. Planifiez avec une marge de 50 à 100 % ; Elasticsearch passe en lecture seule à 95 % d'utilisation du disque. |
| `stateful_pvc_mount_path` | `/usr/share/elasticsearch/data` | **Ne pas modifier** — doit correspondre au paramètre `path.data` d'Elasticsearch. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass. Utilisez `premium-rwo` pour l'indexation vectorielle kNN à haut débit. La StorageClass ne peut pas être modifiée après la création du PVC. |
| `stateful_headless_service` | `null` | Définissez `true` pour créer un service sans tête pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | **Inerte pour ce module.** `elasticsearch.tf` et `main.tf` codent en dur `stateful_fs_group = 1000` (UID/GID d'Elasticsearch) inconditionnellement lors de l'appel à `App_GKE` ; la valeur de cette variable n'est jamais lue. Déclaré pour la compatibilité d'interface `App_GKE` uniquement — aucune action de l'opérateur n'est nécessaire. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Chaînes de quota CPU (par exemple, `"4000m"`). |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets par Kubernetes et bloquent toute planification de pod. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Pour un cluster à nœud unique, `"1"` empêche toute perturbation volontaire — passer à 2+ réplicas avant de réduire cela. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/_cluster/health`, 18 tentatives | **Inerte pour ce module.** Le module déploie toujours une sonde de démarrage `TCP` codée en dur (délai initial de 30s, seuil de 60 tentatives) quelle que soit la valeur de cette variable — aucune action de l'opérateur n'est nécessaire, y compris lorsque `enable_xpack_security = true`. Voir [Comportement de l'application](#3-elasticsearch-application-behaviour). |
| `health_check_config` | HTTP `/_cluster/health`, 3 tentatives | **Inerte pour ce module.** Le module déploie toujours une sonde de vivacité `TCP` codée en dur (délai initial de 60s, seuil de 3 tentatives) quelle que soit la valeur de cette variable — aucune action de l'opérateur n'est nécessaire. |
| `uptime_check_config` | désactivé | Vérification de disponibilité facultative de Cloud Monitoring par rapport à `/_cluster/health`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Les Jobs Kubernetes s'exécutent avant le démarrage du pod Elasticsearch. Non requis pour Elasticsearch — il s'amorce lui-même. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par exemple, tâches de gestion du cycle de vie des index). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Elasticsearch. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

NFS n'est pas requis pour Elasticsearch — toutes les données résident dans le PVC du StatefulSet.
Les variables NFS sont présentes pour la compatibilité de l'interface de fondation mais sont désactivées par défaut
(`enable_nfs = false`). Voir [App_GKE](App_GKE.md) pour plus de détails.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

Les buckets Cloud Storage ne sont pas requis pour Elasticsearch (`create_cloud_storage =
false` par défaut). Les variables Artifact Registry contrôlent la politique de rétention d'image
pour l'image Elasticsearch mise en miroir :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Âge après lequel les images sont éligibles à la suppression. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options de chiffrement CMEK. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron de sauvegarde (UTC). Pour Elasticsearch, envisagez les instantanés Elasticsearch natifs vers GCS plutôt que les sauvegardes au niveau du système d'exploitation. |
| `backup_retention_days` | `7` | Rétention en jours ; augmenter pour la production/conformité. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour un nom d'hôte personnalisé + certificat géré. Ne prend effet que lorsque `application_domains` n'est pas vide. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tags réseau de pod GKE pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

IAP est **non recommandé** pour Elasticsearch — utilisez plutôt des contrôles au niveau du réseau
(`enable_network_segmentation`, règles de pare-feu). Les variables IAP sont présentes
pour des raisons d'exhaustivité.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Elasticsearch. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé. |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Non applicable pour Elasticsearch. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `elasticsearch_endpoint` | Sortie principale pour RAGFlow. `http://<service_external_ip>:9200`. Transmettez-la à la variable `elasticsearch_hosts` de `RAGFlow_GKE`. Renvoie `null` jusqu'à ce que l'IP externe soit attribuée. |
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer. |
| `api_url` | URL du service. |
| `statefulset_name` | Nom de la ressource StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (liste vide — aucun bucket n'est provisionné). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration exécutés avant la charge de travail. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que toutes les ressources de la charge de travail sont déployées. `false` lors du premier apply d'un nouveau cluster — le pipeline CI/CD doit relancer l'apply pour terminer le déploiement. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |
| `elasticsearch_username` | Nom d'utilisateur superutilisateur Elasticsearch. Toujours `"elastic"`. N'a de sens que lorsque `enable_xpack_security = true`. |
| `elasticsearch_password_secret_id` | ID du secret Secret Manager contenant le mot de passe superutilisateur `elastic` auto-généré. Chaîne vide lorsque `enable_xpack_security = false`. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC, tous les index sont stockés dans le système de fichiers éphémère du pod et perdus définitivement à chaque redémarrage, mise à jour progressive ou éviction de nœud. |
| `stateful_pvc_mount_path` | `/usr/share/elasticsearch/data` | Critique | Doit correspondre à `path.data`. Une non-concordance écrit silencieusement les index dans la couche éphémère — les données sont perdues à chaque redémarrage. |
| `cluster_name` | défini une fois | Critique | Immuable après le premier index. Le renommage entraîne le rejet par Elasticsearch de toutes les données PVC comme étrangères ; une réindexation complète est nécessaire. |
| `es_java_heap` vs `memory_limit` | tas ≤ `memory_limit / 2` | Critique | Le tas dépassant la moitié de la mémoire du conteneur entre en concurrence avec le cache de pages de Lucene ; des arrêts OOM se produisent sous charge de recherche. Une précondition au moment de la planification l'impose. |
| `stateful_fs_group` | n/a — codé en dur | n/a | Le module transmet toujours `stateful_fs_group = 1000` (UID/GID d'Elasticsearch) à `App_GKE`, quelle que soit cette variable. Ce n'est pas une préoccupation de l'opérateur ; listé ici uniquement parce que la variable existe sur l'interface. |
| `max_instance_count` | `1` | Critique | L'augmentation sans remplacement de `discovery.type` crée des clusters isolés à nœud unique. Appliqué au moment de la planification. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critique | Les entiers bruts sont des octets et bloquent immédiatement toute planification. |
| `enable_xpack_security` | `true` pour la production | Élevé | Avec `false`, tout appelant pouvant atteindre le port 9200 peut lire, écrire ou supprimer tous les index sans identifiants. |
| `stateful_pvc_size` | taille avec 50 à 100 % de marge | Élevé | Un PVC sous-dimensionné déclenche une protection par seuil de niveau d'eau à 95 % de remplissage ; l'index devient en lecture seule. |
| `stateful_pvc_storage_class` | `standard-rwo` (ou `premium-rwo` pour la production) | Moyen | `standard-rwo` est adéquat pour les charges de travail de recherche typiques ; l'indexation kNN vectorielle à haut débit bénéficie de `premium-rwo`. La StorageClass ne peut pas être modifiée après la création du PVC. |
| `memory_limit` | ≥ `2 × es_java_heap` | Critique | Une marge de mémoire insuffisante déclenche des arrêts OOM pendant la recherche/l'indexation. |
| `startup_probe_config` / `health_check_config` | n/a — codé en dur en TCP | n/a | Le module déploie toujours des sondes TCP codées en dur, quelles que soient les valeurs de ces variables, de sorte qu'une non-concordance HTTP-vs-X-Pack ne peut pas se produire ; il n'y a rien à remplacer. Listé ici uniquement parce que les variables existent sur l'interface. |
| `enable_image_mirroring` | `true` | Faible | La désactivation de la mise en miroir tire directement du registre d'Elastic ; les limites de débit peuvent entraîner des échecs de déploiement intermittents. |
| `application_version` | `8.13.4` (ou version verrouillée) | Moyen | Les mises à niveau de version majeure (7.x → 8.x) peuvent nécessiter des vérifications de compatibilité d'index ; ne pas mettre à niveau sans consulter le guide de migration Elasticsearch. |
| `pdb_min_available` vs `min_instance_count` | marge | Moyen | `pdb_min_available = "1"` avec un cluster à pod unique empêche toute perturbation volontaire (par exemple, les mises à niveau de nœuds) de se poursuivre. Mettre à l'échelle à 2 pods ou plus ou accepter la contrainte. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Elasticsearch sur GKE Autopilot](../labs/Elasticsearch_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- Déployé avec [MongoDB sur GKE Autopilot](MongoDB_GKE.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) dans la solution **Services de données partagés**.
