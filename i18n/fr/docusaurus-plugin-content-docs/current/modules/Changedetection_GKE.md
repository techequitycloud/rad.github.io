---
title: "Changedetection sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Changedetection sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Changedetection_GKE.md @ e69407af sha256:6fcfb1a39994 -->

# Changedetection sur GKE Autopilot {#changedetection-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Changedetection_GKE.png" alt="Changedetection sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

changedetection.io est un service open source auto-hébergé qui surveille les pages web
pour détecter les changements et envoie des notifications lorsqu'ils se produisent. Ce module déploie
changedetection.io sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par changedetection.io et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de changedetection.io sur RAD et comparaison {#what-changedetectionio-costs-on-rad-and-how-that-compares}

**changedetection.io sur le module GKE Autopilot de RAD coûte environ 42 US$ par mois dans votre propre projet Google Cloud, sans frais de licence supplémentaires** — changedetection.io est open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé à **67 crédits par jour** (environ 2 010 par mois, soit environ 201 US$ au prix de la recharge). Ou consultez le [guide Cloud Run](Changedetection_CloudRun.md) pour l'option à moindre coût. Si vous n'avez besoin de changedetection.io qu'occasionnellement — pour des études, une démo, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

changedetection.io est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, environ 2 010 par mois (environ 201 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de gestion de cluster GKE partagés)** | **environ 42 US$** |

Ces prix sont les mêmes en africa-south1 (Johannesburg).

- **GKE Autopilot ne se met pas à l'échelle à zéro.** Au moins un pod est toujours en cours d'exécution, de sorte que le coût ci-dessus s'applique que quelqu'un utilise ou non l'application ; des pods supplémentaires ne sont ajoutés que sous charge.

### Comparaison pour la surveillance des pages web {#how-it-compares-for-monitoring-pages-for-changes}

L'équipe de changedetection.io vend un plan hébergé directement sur changedetection.io : **8,99 US$ par mois**, incluant 5 000 surveillances d'URL, annulable à tout moment. Ce plan unique est le moyen le plus simple de l'utiliser sans rien avoir à gérer ; le module de RAD exécute le même changedetection.io open source sur une infrastructure que vous pouvez voir, sans plafond de nombre de surveillances autre que ce que la taille de l'instance supporte, pour les frais de module plus l'utilisation de Google Cloud ci-dessus — environ 19 US$ par mois dans votre propre projet, un peu plus que le plan hébergé mais avec les données résidant dans votre propre projet.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si changedetection.io s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet — plutôt que la suppression
de ce seul module — délie d'abord sa facturation, puis demande à Google de supprimer
définitivement le projet. Google le conserve, récupérable, pendant 30 jours, et comme la
facturation est déjà déliée, rien n'est facturé pendant cette période. Contrairement à la
suppression d'un module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul
une par une : l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut demander à Google de récupérer le projet et de rattacher son compte de facturation, puis d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture jamais les frais de module à nouveau. Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et atteindre à nouveau le seuil d'admission du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression douce de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer s'il y a quelque chose à conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 79 crédits (environ 7,90 US$) au prix de la recharge, et environ 15 à 20 minutes de temps de build (moyenne de la propre plateforme de RAD). La suppression ne permet d'économiser de l'argent que si changedetection.io resterait inutilisé pendant environ **3 jours ou plus** — dans votre propre projet, cela représente environ 1,40 US$ par jour, et dans un projet géré par RAD, c'est 67 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de changedetection.io alors qu'une autre application partage le projet n'économise que la partie calcul de changedetection.io.
- **Conserver les données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et la mise en garde sur le bucket de sauvegarde ;
[plan hébergé changedetection.io](https://changedetection.io/) ; les prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

changedetection.io s'exécute comme une seule charge de travail web Python/Flask. Le déploiement
relie un ensemble délibérément restreint de services Google Cloud — il n'y a pas de base de
données ni de cache :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Python/Flask, 1 vCPU / 1 Gio par défaut, écoute sur le port 5000 |
| Base de données | _Aucune_ | changedetection.io stocke tout l'état sur disque, pas en SQL |
| Stockage de données persistant | Disque persistant par blocs (PVC) ou Cloud Storage (GCS FUSE) | Monté à `/datastore` ; un PVC par blocs via StatefulSet est fortement préféré |
| Cache et file d'attente | _Aucun_ | Redis n'est pas utilisé ; explicitement désactivé |
| Secrets | Secret Manager | Aucun secret d'application n'est injecté ; le jeton d'API REST est créé dans l'interface utilisateur web |
| Ingress | Cloud Load Balancing | Service `ClusterIP` derrière un Ingress Kubernetes avec une IP statique réservée et un certificat géré (domaine personnalisé activé par défaut ; un hôte `nip.io` est utilisé si aucun n'est défini) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** changedetection.io est entièrement autonome. Il n'y a pas
  d'instance Cloud SQL, pas de job `db-init`, et pas d'étape de migration de schéma. Redis est désactivé
  (`enable_redis = false`) et `enable_cloudsql_volume = false`.
- **Le PVC par blocs est la valeur par défaut pour le stockage de données.** changedetection.io écrit un
  stockage de données basé sur des fichiers (JSON de surveillance plus fichiers d'instantanés d'historique)
  qui se comporte mieux sur un volume de blocs POSIX, donc `stateful_pvc_enabled = true` par défaut, montant un PVC de blocs de 20 Gio (via un
  StatefulSet) à `/datastore`. Cela **désactive automatiquement le volume GCS FUSE** au
  même chemin (`enable_gcs_storage_volume = false`) pour éviter un double montage.
- **GCS FUSE est la solution de secours.** Avec `stateful_pvc_enabled = false`, le bucket GCS du stockage de données
  est monté à `/datastore` via GCS FUSE à la place. Cela fonctionne mais est moins
  adapté aux écritures basées sur des fichiers de l'application qu'un PVC par blocs.
- **Réplica unique par défaut.** `min_instance_count = 1` et `max_instance_count = 1`.
  Le planificateur de récupération s'exécute en interne sur un seul stockage de données ; l'exécution de
  plusieurs réplicas sur le même stockage de données risque une corruption par écriture concurrente. Gardez
  `max_instance_count = 1`.
- **Pas de connexion par défaut.** Le tableau de bord est livré sans connexion. Définissez un mot de passe dans
  **Settings → General** immédiatement, et/ou placez l'IAP devant la charge de travail.
- **`BASE_URL` n'est pas défini automatiquement sur GKE.** Définissez `BASE_URL` (l'hôte du lien de notification)
  sur l'URL externe du LoadBalancer ou du domaine personnalisé via `environment_variables`
  une fois que l'IP externe est connue.
- **Verrouillage de version.** Avec `application_version = "latest"`, la construction de l'image verrouille une
  balise connue et fonctionnelle (`0.50.19`) via l'argument de construction `CHANGEDETECTION_VERSION` spécifique à l'application.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail changedetection.io {#a-gke-autopilot--the-changedetectionio-workload}

Les pods changedetection.io sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent réellement. Puisque `stateful_pvc_enabled = true` par défaut, `workload_type`
se résout automatiquement en un **StatefulSet** avec un PVC par pod ; définissez `stateful_pvc_enabled =
false` pour un `Deployment` avec un volume GCS FUSE à la place.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail changedetection pour
  voir les pods et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet).

### B. Base de données — non utilisée {#b-database--not-used}

changedetection.io n'utilise **aucune base de données SQL**. `database_type = NONE` est fixé par
[Changedetection_Common](Changedetection_Common.md) ; aucune instance Cloud SQL n'est créée
et il n'y a pas de job d'initialisation `db-init`. Les entrées `db_name`/`db_user` n'existent que
pour la compatibilité de la Fondation et ne provisionnent rien. Tout l'état persistant réside dans le
volume de stockage de données décrit ci-dessous.

### C. Stockage de données persistant (PVC ou Cloud Storage) {#c-persistent-datastore-pvc-or-cloud-storage}

Toutes les configurations de surveillance, les instantanés de page et l'historique des modifications se trouvent sous `/datastore`.

- **PVC par blocs (par défaut).** Avec `stateful_pvc_enabled = true` (la valeur par défaut), un
  StatefulSet monte un disque persistant par blocs de 20 Gio à `stateful_pvc_mount_path`
  (`/datastore`).
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```
- **GCS FUSE (solution de secours).** Avec `stateful_pvc_enabled = false`, le bucket GCS du stockage de données
  est monté à `/datastore` via le pilote CSI GCS FUSE.
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/
  ```

Voir [App_GKE](App_GKE.md) pour les PVC StatefulSet, les options CMEK et les montages GCS FUSE.

### D. Cache et file d'attente — non utilisés {#d-cache--queue--not-used}

changedetection.io n'utilise pas Redis ni aucune file d'attente externe ; son planificateur de surveillance est
intégré au processus. `enable_redis = false` est défini explicitement (remplaçant la valeur par défaut de App_GKE de
`true`) et aucune entrée Redis n'est câblée.

### E. Secret Manager {#e-secret-manager}

Aucun secret d'application n'est injecté dans le pod — le jeton d'API REST optionnel est généré
dans l'interface utilisateur web (**Settings → API**), et le stockage de données n'utilise pas de clé de chiffrement. Secret
Manager est toujours disponible pour tout `secret_environment_variables` fourni par l'opérateur.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, le service Kubernetes est `ClusterIP` (`service_type = ClusterIP`) et la
charge de travail est exposée via un Ingress Kubernetes avec une IP statique réservée et un
certificat géré par Google (`enable_custom_domain = true`, `reserve_static_ip = true`).
Lorsque aucun `application_domains` n'est défini, un nom d'hôte `nip.io` dérivé de l'IP réservée
est utilisé afin que HTTPS fonctionne dès la sortie de la boîte.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers Cloud Monitoring. Des
tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application changedetection.io {#3-changedetectionio-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de base de données ni de job d'initialisation. Au premier
  démarrage, changedetection.io crée ses fichiers de stockage de données (`url-watches.json` et
  répertoires d'historique par surveillance) sous `/datastore` s'ils n'existent pas déjà.
- **Pas de migrations de schéma.** Les mises à niveau du format du stockage de données sont gérées en interne par l'application
  au démarrage ; il n'y a pas d'étape de migration distincte à exécuter.
- **Le volume de stockage de données est le seul actif persistant.** Tout ce que l'application retient —
  surveillances, instantanés, historique des différences, configuration des notifications et tout mot de passe d'interface utilisateur —
  réside sur le volume `/datastore` (PVC par blocs ou bucket GCS). La suppression du PVC/bucket efface tout
  l'état.
- **Pas de connexion par défaut.** Le tableau de bord est livré ouvert. Définissez un mot de passe sous
  **Settings → General → Password** immédiatement après le premier accès, et/ou activez l'IAP devant
  la charge de travail. Il n'y a pas de compte administrateur ou de credential par défaut.
- **Le jeton d'API REST est créé dans l'interface utilisateur.** Pour utiliser l'API REST, générez un jeton sous
  **Settings → API** et passez-le comme en-tête `x-api-key`. Il n'est pas injecté via une
  variable d'environnement.
- **Définissez `BASE_URL` une fois l'IP externe connue.** Contrairement à la variante Cloud Run, l'enveloppe
  GKE n'injecte pas de `BASE_URL` utilisable. Définissez-le sur l'URL externe afin que
  les corps de notification contiennent des liens fonctionnels :
  ```bash
  kubectl set env -n "$NAMESPACE" statefulset/<name> \
    BASE_URL=https://changedetection.example.com
  ```
  Ou définissez `environment_variables = { BASE_URL = "https://…" }` dans la configuration du module.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — l'interface utilisateur web, qui renvoie
  HTTP 200 une fois que le serveur Flask est prêt. Le premier démarrage est rapide (pas de migrations) ; la
  sonde de démarrage par défaut autorise un délai initial de 15 secondes plus une fenêtre de 10 tentatives.
- **Contrainte de mise à l'échelle.** Gardez `max_instance_count = 1`. Plusieurs réplicas partagent le même
  stockage de données et entreraient en concurrence sur les écritures ; l'application n'a pas de coordination distribuée.
- **Inspecter l'environnement d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'DATASTORE_PATH|BASE_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour changedetection.io sont listés ; toutes les autres entrées sont héritées
de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `changedetection` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise de version de l'image. `latest` épingle la build à `0.50.19` via `CHANGEDETECTION_VERSION` ; épinglez explicitement pour des déploiements reproductibles. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure (pas de charge de travail). |
| `min_instance_count` | `1` | Maintenez à 1 pour que le planificateur de récupération s'exécute toujours. |
| `max_instance_count` | `1` | **Maintenez à 1** — plusieurs réplicas entrent en concurrence sur le stockage de données partagé. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — le sidecar Auth Proxy n'est pas nécessaire. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image changedetection.io dans Artifact Registry. |
| `container_port` | `5000` | Fixé à 5000 par Changedetection_Common ; non transmis à App_GKE. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Définissez `BASE_URL` ici pour les liens de notification ; `DATASTORE_PATH` est défini automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé ; l'ingress est géré séparément (Groupe 19). |
| `workload_type` | `null` (auto) | Se résout en `StatefulSet` puisque `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | Pas de routage persistant par défaut ; définissez `ClientIP` si vous souhaitez qu'un client continue de frapper le même pod. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet (Persistance du stockage de données) {#group-7--statefulset-datastore-persistence}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Monte un PVC par blocs à `/datastore` (préféré). Désactive automatiquement le volume GCS FUSE au même chemin. Définissez `false` pour utiliser GCS FUSE à la place. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod pour le stockage de données. |
| `stateful_pvc_mount_path` | `/datastore` | Chemin de montage du stockage de données — correspond à `DATASTORE_PATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour le PVC. |

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
| `startup_probe` | HTTP `/` 15s de délai | Sonde de démarrage contre l'interface utilisateur web. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité contre l'interface utilisateur web. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation intégré — changedetection.io ne nécessite pas de bootstrap. |
| `cron_jobs` | `[]` | CronJobs Kubernetes optionnels (l'application planifie ses propres vérifications de surveillance). |
| `additional_services` | `[]` | Services sidecar/d'aide (par exemple, un récupérateur de navigateur Playwright). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé ; le stockage de données utilise un PVC par blocs ou GCS FUSE. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur (lorsque NFS est activé). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket GCS du stockage de données (utilisé pour la solution de secours FUSE et les sauvegardes). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires via le pilote CSI. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` (effectif) | La variable elle-même par défaut `true`, mais l'enveloppe `main.tf` code en dur `enable_redis = false` dans l'appel de la Fondation et ne transmet jamais `var.enable_redis` — changedetection.io n'utilise pas Redis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` / `db_user` | `""` | Non utilisé — transmis uniquement pour la compatibilité de la Fondation ; aucune base de données n'est créée. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). Sauvegarder le volume/bucket du stockage de données (aucune base de données n'existe). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'Ingress pour les noms d'hôtes personnalisés + certificat géré (revient à un hôte `nip.io` lorsque `application_domains` est vide). |
| `application_domains` | `[]` | Noms d'hôtes à servir (également la valeur à définir pour `BASE_URL`). |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Recommandé.** changedetection.io n'a pas de connexion propre — l'IAP place l'authentification Google
> devant le tableau de bord.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant changedetection.io. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre changedetection.io. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de stockage de données). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsque `stateful_pvc_enabled = true`). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment du plan — IAP sans identités autorisées, `min_instance_count > max_instance_count`, une charge de travail `Deployment` associée à `stateful_pvc_enabled = true`, des valeurs de quota de ressources en unités binaires, un `backup_retention_days` hors de portée. Une configuration invalide échoue au **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC du stockage de données / bucket GCS | Ne jamais supprimer/recréer | Critique | Le volume contient toutes les surveillances, instantanés et entrées d'historique — sa suppression entraîne la perte permanente de tout l'état de surveillance. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent simultanément sur le même stockage de données et corrompent `url-watches.json` ; l'application n'a pas de verrouillage distribué. |
| `stateful_pvc_enabled` vs `workload_type` | `true` (StatefulSet sélectionné automatiquement ; les deux par défaut) | Élevé | La définition de `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` échoue au moment du plan ; la persistance du PVC par blocs nécessite un StatefulSet. |
| Mot de passe de l'interface web | Définir immédiatement | Élevé | Le tableau de bord est livré **sans connexion** ; exposer le point d'accès Ingress sans mot de passe (ou IAP) révèle toutes les surveillances et la configuration des notifications. |
| `application_name` | Définir une fois | Élevé | Immuable après le premier déploiement ; le renommage recrée le bucket/PVC du stockage de données et orpheline les données existantes. |
| `stateful_pvc_mount_path` / `DATASTORE_PATH` | `/datastore` | Élevé | Une non-concordance signifie que le stockage de données est écrit sur un disque de pod éphémère et perdu au redémarrage/replanification. |
| `BASE_URL` | URL du LoadBalancer externe / du domaine | Moyen | Non injecté sur GKE — le laisser non défini produit des liens absolus brisés dans les notifications de changement. |
| `enable_iap` | Activer (ou définir un mot de passe d'interface utilisateur) | Élevé | Sans IAP ou mot de passe d'interface utilisateur, le point d'accès Ingress public expose un tableau de bord non authentifié. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. Maintenir 1 maintient le planificateur de récupération en cours d'exécution. |
| `enable_redis` / `enable_cloudsql_volume` | `false` / `false` | Faible | changedetection.io n'a besoin ni de l'un ni de l'autre ; les activer provisionne une infrastructure inutilisée. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité de la sauvegarde du stockage de données. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à changedetection.io partagée avec la variante Cloud Run
est décrite dans **[Changedetection_Common](Changedetection_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Changedetection.io sur GKE Autopilot](../labs/Changedetection_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Changedetection sur Google Cloud Run](Changedetection_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Changedetection Common — Configuration d'application partagée](Changedetection_Common.md) — la configuration partagée par les deux cibles de déploiement.
