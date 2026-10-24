---
title: "DokuWiki sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de DokuWiki sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/DokuWiki_GKE.md @ e69407af sha256:b23521258657 -->

# DokuWiki sur GKE Autopilot {#dokuwiki-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DokuWiki_GKE.png" alt="DokuWiki sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

DokuWiki est un wiki léger, conforme aux standards, basé sur des **fichiers plats**
(sans base de données) qui stocke tout son contenu — pages, médias, plugins,
utilisateurs et configuration — sous forme de fichiers sur disque. Ce module
déploie DokuWiki sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par DokuWiki et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte DokuWiki sur RAD, et comment cela se compare {#what-dokuwiki-costs-on-rad-and-how-that-compares}

**Le module DokuWiki sur GKE Autopilot de RAD coûte environ 24,04 $ US par mois.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer le système d'exploitation, les correctifs de sécurité et les mises à niveau vous-même. Pour le coût le plus bas, le [guide Cloud Run](DokuWiki_CloudRun.md) exécute le même DokuWiki pour environ 16,78 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — études, démo, activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 24,04 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **24,04 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **55 crédits par jour**, environ 1 650 par mois (environ 165 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5 vCPU / 0,5 Gio | 18,04 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 24,04 $ US** |

### Comment cela se compare {#how-it-compares}

- DokuWiki n'a pas d'édition commerciale officielle dans le cloud à laquelle se comparer — il n'y a pas de fournisseur vendant de "hébergement DokuWiki" comme Odoo ou Documenso vendent les leurs. La comparaison honnête est un VPS nu : même le niveau le plus petit et le moins cher de Hetzner ou DigitalOcean exécute confortablement un wiki à fichiers plats sans base de données, bien en dessous de la classe de 2 vCPU à ~24 $ US/mois que ces fournisseurs citent pour une application plus lourde.
- Ce que vous payez à RAD ici est moins lié à la puissance de calcul brute — DokuWiki est déjà presque gratuit à exécuter — et plus au fait de ne pas avoir à maintenir le système d'exploitation, le certificat TLS et le stockage basé sur GCS vous-même.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si DokuWiki s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque
rien.** Cela convient bien mieux à DokuWiki dont vous n'avez besoin qu'occasionnellement — études, démo, activité
saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un module, cela ne détruit pas le pod GKE ou son bucket de stockage un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de DokuWiki, contre
  les 40 crédits (4,05 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 24,04 $ US.** Déployez DokuWiki, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles DokuWiki était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et que RAD ne gère
  que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démo).
  Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque, et cela compte plus ici que pour une application basée sur une base de données.** DokuWiki n'a pas
  de base de données séparée sur laquelle se rabattre — le bucket de stockage contenant vos pages et médias est la
  seule copie. Il n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse
  dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours.
  Copiez le contenu du bucket avant de le supprimer si votre wiki contient des éléments que vous n'avez pas
  copiés ailleurs.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée,
la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 44 crédits
  (4,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant DokuWiki. La suppression permet d'économiser de l'argent une fois que DokuWiki resterait inutilisé
  pendant environ **6 jours ou plus** dans votre propre projet (environ 0,80 $ US par jour), ou environ
  **1 jour ou plus** dans un projet géré par RAD (55 crédits par jour).
- **Supprimez tout ce que DokuWiki utilise.** DokuWiki n'a pas de base de données ou de VM séparée — son seul coût d'exécution est son propre calcul et un peu de réseau — donc le supprimer arrête essentiellement tous ses propres coûts immédiatement.
- **Conservez d'abord vos données.** DokuWiki conserve l'intégralité de son wiki — pages, médias, plugins et configuration — dans ce seul bucket de stockage, et le bucket est supprimé avec le déploiement. Copiez son contenu (vers Google Drive, ou un bucket que vous conservez) avant de le supprimer si vous souhaitez conserver votre wiki.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les
  paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de
  DokuWiki dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute DokuWiki pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
Frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

DokuWiki s'exécute comme une charge de travail PHP/Apache sur GKE Autopilot. Comme il s'agit d'un
wiki à fichiers plats avec état, cette variante le déploie comme un **StatefulSet** avec un
PersistentVolumeClaim de bloc durable, et non comme un déploiement sans état. Le déploiement relie un
ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP/Apache sur le port 8080, 500m vCPU / 512 Mio par défaut ; **StatefulSet** |
| Base de données | **Aucune** | DokuWiki est un wiki à fichiers plats — `database_type = "NONE"`, aucune instance Cloud SQL provisionnée |
| Stockage persistant | Persistent Disk (PVC de bloc) | Un PVC de bloc monté à `/storage` contient *tout* l'état du wiki |
| Cache et file d'attente | **Aucun** | Pas de Redis ; DokuWiki n'a pas de modèle de file d'attente/travailleur |
| Secret Manager | **Aucun** | Pas de secrets d'application — le compte administrateur est créé via `/install.php` |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** DokuWiki stocke tout dans le répertoire de fichiers plats `/storage`.
  `database_type` est fixé à `"NONE"` ; une validation au moment de la planification rejette toute autre
  valeur. `enable_cloudsql_volume` est également `false`.
- **StatefulSet avec un PVC de bloc.** `stateful_pvc_enabled = true` et
  `stateful_pvc_mount_path = "/storage"`, donc `workload_type` sélectionne automatiquement
  `StatefulSet` (laissez `workload_type = null`). Un PVC de bloc gère le verrouillage des fichiers plats de DokuWiki
  bien mieux que gcsfuse — c'est la variante recommandée pour
  l'édition concurrente.
- **Tout l'état réside sur le PVC.** La variante GKE supprime le volume/bucket GCS par défaut du module Common
  (`gcs_volumes = []`, `module_storage_buckets = []`) ; la persistance
  est le PVC de bloc `/storage` seul (`stateful_pvc_size = 10Gi` par défaut).
- **Minimum 1 réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle à zéro ;
  `min_instance_count = 1`). Gardez le nombre de réplicas faible — les PVC par pod d'un StatefulSet ne sont pas
  partagés, donc plusieurs réplicas ne partagent **pas** le contenu du wiki.
- **Pas de secrets d'exécution.** Le compte administrateur est créé de manière interactive lors de la première
  visite via `/install.php` et stocké sur le PVC.
- **LoadBalancer externe par défaut** (`service_type = LoadBalancer`) afin que le wiki soit
  accessible à une adresse IP externe. Activez IAP ou un domaine personnalisé si nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail DokuWiki {#a-gke-autopilot--the-dokuwiki-workload}

Les pods DokuWiki sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Comme DokuWiki est avec état, il s'exécute comme un **StatefulSet** avec un
PVC de bloc par pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail DokuWiki pour voir
  les pods et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # PVC bound to the /storage disk
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Base de données — non utilisée {#b-database--not-used}

DokuWiki n'utilise **pas** de base de données. `database_type = "NONE"`, aucune instance Cloud SQL
n'est créée, aucun job `db-init` ne s'exécute, et `enable_cloudsql_volume = false` (pas de sidecar Auth Proxy).
La garde de planification dans le module rejette toute valeur non-`NONE` `database_type`.

### C. Stockage persistant — le PVC de bloc `/storage` {#c-persistent-storage--the-storage-block-pvc}

L'état entier de DokuWiki réside sur un **PersistentVolumeClaim de bloc** (un Persistent Disk de Compute Engine)
monté à `/storage`. Ceci est provisionné par le `volumeClaimTemplate` du StatefulSet ; il n'y a **pas** de bucket Cloud Storage
sur cette variante.

- **Console :** Kubernetes Engine → Stockage → Persistent Volume Claims ; Compute Engine →
  Disques pour le disque de support.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Browse the wiki data on the running pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /storage/data/pages
  ```

Augmentez `stateful_pvc_size` avant le déploiement si vous prévoyez de grandes bibliothèques de médias ;
le redimensionnement d'un PVC lié par la suite dépend du support d'expansion de la StorageClass.

### D. Redis — non utilisé {#d-redis--not-used}

DokuWiki n'a pas de modèle de file d'attente ou de travailleur et n'utilise pas Redis. `enable_redis` est désactivé par
défaut et il n'y a aucune raison de l'activer.

### E. Secret Manager — pas de secrets d'application {#e-secret-manager--no-application-secrets}

DokuWiki n'injecte **aucun** secret d'exécution. Le compte administrateur est créé via l'installateur
de première exécution (`/install.php`) et persisté sur le PVC, il n'y a donc pas de clé générée à récupérer.
`secret_environment_variables` reste vide par conception.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs stdout/stderr des pods (logs Apache) sont envoyés à Cloud Logging ; les métriques GKE sont envoyées à Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application DokuWiki {#3-dokuwiki-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Il n'y a pas de schéma à créer et pas de job `db-init`.
  `initialization_jobs` est vide. Le premier démarrage initialise le PVC `/storage` avec le wiki par défaut
  (géré par le point d'entrée de l'image amont) s'il est vide.
- **Configuration initiale via `/install.php`.** Lors de la première visite, ouvrez
  `http://<external-ip>/install.php` pour créer le compte administrateur, définir le titre du wiki et
  choisir la politique ACL. Ceci est écrit sur le PVC. **Supprimez ou bloquez
  `install.php` après** — toute personne y accédant avant la fin de la configuration peut
  revendiquer le compte administrateur.
- **Tout l'état est sur le PVC.** La suppression du PVC (ou du StatefulSet avec son PVC)
  détruit le wiki. Sauvegardez le disque avant la suppression si vous souhaitez conserver le contenu.
- **StatefulSet, pas Deployment.** DokuWiki est avec état ; `stateful_pvc_enabled = true`
  sélectionne automatiquement `workload_type = "StatefulSet"`. Ne **pas** définir `workload_type =
  "Deployment"` en même temps — cette combinaison échoue au moment de la planification.
- **Les réplicas ne partagent pas le contenu.** Chaque pod StatefulSet obtient son propre PVC, donc la mise à l'échelle
  au-delà de 1 réplica donne à chaque pod un wiki *séparé et vide*. Gardez `min`/`max` à 1, sauf
  si vous avez un plan de stockage partagé externe ; DokuWiki n'a pas de clustering intégré.
- **Pas de migrations automatiques.** La mise à niveau de `application_version` fournit un moteur DokuWiki plus récent
  qui lit les mêmes données `/storage` ; il n'y a pas d'étape de migration.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent toutes `/` — DokuWiki
  sert sa page de démarrage sans authentification, donc la sonde passe dès qu'Apache est
  opérationnel. Le premier démarrage se termine en quelques secondes (pas de migrations de base de données).
- **Inspectez les montages et l'environnement du pod :**
  ```bash
  kubectl get statefulset <service-name> -n "$NAMESPACE" -o \
    jsonpath='{.spec.template.spec.containers[0].volumeMounts}' ; echo
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour DokuWiki sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DokuWiki ; `latest` se résout en une version datée épinglée (`2024-02-06b`) au moment de la compilation. Épinglez une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE exige ≥ 1. Gardez à 1 — les PVC StatefulSet ne sont pas partagés. |
| `max_instance_count` | `1` | Plafond de coût. Ne pas dépasser 1 pour un wiki partagé — chaque pod obtient son propre PVC vide. |
| `container_port` | `8080` | Apache écoute sur 8080. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | DokuWiki est léger. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — pas de sidecar Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image DokuWiki dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose DokuWiki à une adresse IP externe. |
| `workload_type` | `null` | Laisser nul — `stateful_pvc_enabled = true` sélectionne automatiquement `StatefulSet`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Sauvegarde `/storage` avec un PVC de bloc durable. Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod pour le contenu/média du wiki. Dimensionnez à l'avance pour les grands médias. |
| `stateful_pvc_mount_path` | `/storage` | Doit être le répertoire de données de DokuWiki pour que le contenu persiste. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass pour le PVC. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Une garde de planification rejette toute autre valeur. |

_Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md)._

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre DokuWiki. |
| `storage_buckets` | Buckets Cloud Storage créés (vides sur GKE — la persistance est le PVC de bloc). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vides — DokuWiki n'en a pas). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, `min_instance_count` au-dessus de `max`, une charge de travail `Deployment` avec `stateful_pvc_enabled = true`, des valeurs `quota_memory_*` entières brutes — plus des gardes spécifiques au module pour un `NONE` non-`database_type`. Une configuration invalide fait échouer la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC de bloc `/storage` | Ne jamais supprimer après le premier déploiement | Critique | Le PVC *est* le wiki — le supprimer (ou le StatefulSet avec son PVC) entraîne la perte de toutes les pages, médias et utilisateurs. Sauvegarder le disque avant la suppression. |
| `database_type` | `NONE` | Critique | Toute autre valeur fait échouer la garde de planification ; si elle est contournée, elle provisionne une instance Cloud SQL inutilisée et des coûts. |
| `install.php` après la configuration | Supprimer / bloquer une fois que l'administrateur existe | Élevé | Toute personne qui atteint `/install.php` avant que vous n'ayez terminé la configuration peut revendiquer le compte administrateur. |
| `workload_type` | `null` (auto → StatefulSet) | Élevé | Définir `Deployment` avec `stateful_pvc_enabled = true` échoue au moment de la planification ; un simple déploiement perdrait des données lors du rééchelonnement. |
| `min_instance_count` / `max_instance_count` | `1` pour un wiki partagé | Élevé | Chaque pod StatefulSet obtient son propre PVC vide — la mise à l'échelle au-delà de 1 divise les utilisateurs entre des wikis séparés et non synchronisés. |
| `stateful_pvc_mount_path` | `/storage` | Élevé | Un chemin différent laisse le répertoire de données de DokuWiki sur le rootfs éphémère du pod — le contenu est perdu à chaque rééchelonnement. |
| `stateful_pvc_size` | Dimensionner à l'avance (`10Gi`+) | Moyen | Les PVC sous-dimensionnés se remplissent de médias ; l'expansion en ligne dépend de la StorageClass. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `service_type` | `LoadBalancer` (ou IAP/domaine) | Moyen | `ClusterIP` rend le wiki inaccessible depuis l'extérieur du cluster sans ingress supplémentaire. |
| `memory_limit` (`container_resources`) | `512Mi` | Moyen | En dessous de 256 Mio, le processus PHP/Apache peut manquer de mémoire sous charge. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à DokuWiki
partagée avec la variante Cloud Run est décrite dans
**[DokuWiki_Common](DokuWiki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DokuWiki sur GKE Autopilot](../labs/DokuWiki_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [DokuWiki sur Google Cloud Run](DokuWiki_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [DokuWiki Common — Configuration d'application partagée](DokuWiki_Common.md) — la configuration partagée par les deux cibles de déploiement.
