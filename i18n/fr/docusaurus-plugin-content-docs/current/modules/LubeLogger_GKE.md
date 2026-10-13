---
title: "LubeLogger sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de LubeLogger sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LubeLogger_GKE.md @ e69407af sha256:cab2e324427c -->

# LubeLogger sur GKE Autopilot {#lubelogger-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LubeLogger_GKE.png" alt="LubeLogger sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LubeLogger est un outil gratuit et open source de suivi de l'entretien des véhicules et de la consommation de carburant, basé sur ASP.NET Core (.NET), livré sous forme d'une seule image conteneur avec une base de données LiteDB embarquée. Ce module déploie LubeLogger sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services Cloud que LubeLogger utilise et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte LubeLogger sur RAD, et comment cela se compare {#what-lubelogger-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de LubeLogger sur RAD coûte environ 42 US$ par mois dans votre propre projet, sans frais par véhicule.** RAD facture 75 crédits une fois par déploiement dans votre propre projet (67,5 crédits, soit 10 % de moins, dans un projet géré par RAD), plus le temps de build. La même application se déploie également sur Cloud Run pour environ 33 US$ par mois — voir le [guide Cloud Run](LubeLogger_CloudRun.md) pour l'option moins chère. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars au lieu de 42 US$ — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201,00 US$ au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins avec un abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 1 GiB | 36 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 US$ si c'est votre seul cluster, sinon ~73 US$ |
| **Total** | **environ 42 US$** |

### Comment cela se compare {#how-it-compares}

- **AUTOsist**, un outil commercial de suivi de l'entretien de flotte, facture **6 à 7 US$ par véhicule et par mois**, avec un **minimum de 59 US$ par mois pour 5 véhicules** sur son forfait de base Maintenance.
- Le module LubeLogger de RAD coûte environ 42 US$ par mois dans votre propre projet — dans la même fourchette que le minimum de 5 véhicules d'AUTOsist, mais sans **frais par véhicule et sans plafond de nombre de véhicules** : un foyer qui suit deux voitures coûte exactement le même prix qu'une petite flotte qui en suit vingt.
- Comparaison autogérée : à 1 vCPU / 1 GiB, un Hetzner CPX22 ou un droplet DigitalOcean de 2 vCPU/4 Go (~24 US$/mois) ferait fonctionner LubeLogger correctement, mais vous devriez toujours gérer le système d'exploitation, les sauvegardes et les mises à niveau vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LubeLogger fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à LubeLogger dont vous n'avez besoin qu'occasionnellement — pour l'évaluer, un environnement de démonstration, une charge de travail saisonnière ou intermittente — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD commence par délier sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un seul module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Pour LubeLogger derrière Services_GCP (un cluster GKE) et Project_GCP, cela représente environ **une poignée de crédits (moins de 1 US$)** au total, contre environ 80 crédits (8,00 US$) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 42 US$.** Déployez LubeLogger, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et le temps réel où il était actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'évaluation conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont écrits dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé LubeLogger et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds — environ 80 crédits (8,00 US$) au total. La suppression ne permet d'économiser de l'argent que si LubeLogger restait inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement — environ **6 jours ou plus**, à la fois dans votre propre projet (environ 1,40 US$ par jour) et dans un projet géré par RAD (67 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement partagée.** Pour LubeLogger, il s'agit de la base de données. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle ; [AUTOsist](https://www.autosist.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LubeLogger s'exécute comme un seul pod ASP.NET Core, recommandé comme un **StatefulSet avec un vrai PVC de stockage par blocs**. Le déploiement connecte un ensemble minimal de services Google Cloud — il n'y a pas de base de données gérée dans la configuration par défaut :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod ASP.NET Core, 1 vCPU / 1 GiB par défaut, fixé à un seul réplica |
| Base de données | Aucune (par défaut) | Le mode par défaut de LubeLogger utilise un fichier de base de données LiteDB embarqué interne — aucune instance Cloud SQL n'est créée |
| Stockage d'objets / stockage par blocs | Cloud Storage + Persistent Disk | Un PVC de blocs (recommandé, `stateful_pvc_enabled = true`) à `/App/data`, plus un petit bucket GCS de `dpkeys` pour les clés de protection des données ASP.NET Core (toujours basé sur GCS) |
| Cache et file d'attente | Aucun | LubeLogger n'utilise pas Redis et n'a pas de worker/file d'attente en arrière-plan |
| Secrets | Aucun | Aucun secret n'est généré — le premier compte est créé via l'enregistrement en libre-service |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe par défaut.** `database_type = "NONE"` — le fichier de base de données LiteDB embarqué de LubeLogger est la source de vérité. LubeLogger prend également en charge un backend Postgres externe facultatif via une seule variable d'environnement DSN `POSTGRES_CONNECTION`, mais ce module ne connecte pas Cloud SQL pour cela.
- **Le PVC de stockage par blocs est la disposition recommandée.** `stateful_pvc_enabled = true` (par défaut) exécute LubeLogger comme un StatefulSet avec un PVC par pod monté à `/App/data` — un vrai périphérique de blocs offre un verrouillage de fichier fiable pour la base de données LiteDB embarquée, contrairement à GCS FUSE.
- **Une seule instance.** `min_instance_count = 1` et `max_instance_count = 1` — le mode par défaut de LubeLogger sert un fichier de base de données partagé à partir d'un seul volume ; l'exécution de plusieurs réplicas sur le même fichier le corrompt.
- **S'exécute en tant que root ; pas besoin de fsGroup.** Confirmé directement sur l'image en cours d'exécution — l'image officielle de LubeLogger n'a pas de directive `USER`, donc `stateful_fs_group` est par défaut `0` (non défini).
- **Sécurisé par défaut.** `EnableAuth = "true"` remplace la valeur par défaut `appsettings.json` de LubeLogger, qui est un accès entièrement ouvert. Il n'y a pas de compte administrateur pré-initialisé — la première personne à remplir le formulaire d'inscription sur `/Login` obtient l'accès.
- **Image pré-construite, pas d'étape de build.** Le module déploie directement l'image officielle `ghcr.io/hargata/lubelogger` (mise en miroir dans Artifact Registry par défaut) — il n'y a pas de Dockerfile ou de Cloud Build impliqué.
- **Accessible de l'extérieur par défaut.** `service_type = "LoadBalancer"` — LubeLogger est une application web publique, pas une charge de travail interne uniquement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LubeLogger {#a-gke-autopilot--the-lubelogger-workload}

LubeLogger s'exécute comme un seul pod (StatefulSet par défaut), qu'Autopilot facture en fonction du CPU/mémoire demandé.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail LubeLogger pour voir le pod, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Stockage persistant — PVC de blocs et Cloud Storage {#b-persistent-storage--block-pvc-and-cloud-storage}

La disposition par défaut (`stateful_pvc_enabled = true`) provisionne un **PVC basé sur Persistent Disk** par pod monté à `/App/data` — cela contient le fichier de base de données LiteDB embarqué et les photos/reçus/documents téléchargés. Un petit bucket **Cloud Storage** séparé (`dpkeys`) est toujours monté via GCS FUSE au chemin fixe `/root/.aspnet/DataProtection-Keys`, indépendamment du PVC.

- **Console :** Kubernetes Engine → Storage (PVCs) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
  ```

Voir [App_GKE](App_GKE.md) pour StorageClass, CMEK et les options de montage GCS Fuse.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LubeLogger {#3-lubelogger-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init` — LubeLogger initialise son propre fichier de base de données LiteDB et sa structure de répertoires (`config/`, `documents/`, `images/`, `temp/`, `themes/`, `translations/` sous `/App/data`) au premier démarrage.
- **Pas de credential administrateur fixe.** Ouvrez le service, allez à `/Login`, et soumettez le formulaire **Register** — cela deviendra le compte utilisable. Complétez cela immédiatement après le premier déploiement : `EnableAuth = "true"` restreint le reste de l'application, mais l'enregistrement lui-même est ouvert à quiconque peut atteindre l'URL jusqu'à ce qu'un premier compte existe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/Login` — la page publique et non authentifiée de LubeLogger. La racine de l'application `/` est protégée par `[Authorize]` et échouerait à une sonde non authentifiée même sur un conteneur sain.
- **Postgres externe facultatif.** LubeLogger prend en charge une seule variable d'environnement DSN `POSTGRES_CONNECTION` (`Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;`) pour utiliser une base de données Postgres externe au lieu du fichier LiteDB embarqué. Ce module ne provisionne pas Cloud SQL pour ce chemin.
- **Instance unique, toujours.** `max_instance_count` est fixé à `1` — le mode par défaut de LubeLogger n'a pas de support de verrouillage distribué ou de multi-écriture pour sa base de données embarquée.
- **S'exécute en tant que root.** Confirmé via `docker inspect`/`docker exec` sur l'image réelle — pas de directive `USER`, le processus s'exécute en tant que uid 0. Pertinent si vous ajoutez un jour un `securityContext` restreint — la configuration par défaut n'en a pas besoin.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour LubeLogger sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `lubelogger` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image sur `ghcr.io/hargata/lubelogger`. L'image étant pré-construite (non construite sur mesure), cela sélectionne directement la version publiée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Maintenu à `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`** — le mode par défaut de LubeLogger sert un fichier de base de données partagé. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Le mode par défaut de LubeLogger n'a pas de Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image LubeLogger dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés avec les paramètres par défaut du module `EnableAuth = "true"`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Utilisez ceci pour `POSTGRES_CONNECTION` si vous connectez le backend Postgres externe facultatif. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LubeLogger est une application web publique, elle est donc par défaut accessible de l'extérieur. |
| `workload_type` | `null` (auto → `StatefulSet`) | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant nécessaire — réplica unique. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; pertinent uniquement si `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL (permet à LubeLogger de vider les écritures). |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Recommandé pour LubeLogger — un vrai PVC de blocs offre un verrouillage de fichier fiable pour la base de données LiteDB embarquée. |
| `stateful_pvc_size` | `20Gi` | Taille de stockage PVC par pod — dimensionné pour la base de données LiteDB, les documents/reçus téléchargés et les frais généraux. |
| `stateful_pvc_mount_path` | `/App/data` | Chemin de montage du conteneur pour le PVC — doit correspondre au répertoire de données de LubeLogger. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC ; utilisez `premium-rwo` pour des IOPS plus élevées. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | Non défini — l'image officielle de LubeLogger s'exécute en tant que root et n'a pas besoin de fsGroup pour écrire sur le PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un Kubernetes ResourceQuota dans l'espace de noms de l'application. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Nécessite un suffixe binaire (par exemple `4Gi`, `8192Mi`) par convention lorsqu'il est défini. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/Login` délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/Login` délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/Login` | Sonde d'infrastructure au niveau App_GKE. |
| `health_check_config` | HTTP `/Login` | Sonde de vivacité au niveau App_GKE. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Le mode par défaut de LubeLogger n'a pas besoin de job d'initialisation. |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme par défaut. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec LubeLogger. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS `storage` et `dpkeys`. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Points de montage GCS Fuse supplémentaires via le pilote CSI. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (par défaut de la fondation) | Transmis pour compatibilité ; `LubeLogger_GKE` le force `false` — LubeLogger n'a pas besoin de Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le mode par défaut de LubeLogger n'a pas de base de données Cloud SQL. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre LubeLogger. |
| `storage_buckets` | Buckets Cloud Storage créés (`storage`, `dpkeys`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Le mode par défaut de LubeLogger sert un fichier de base de données embarqué partagé à partir d'un seul volume ; plus d'un réplica risque la corruption de la base de données par des écritures concurrentes. Appliqué par une garde de validation au moment de la planification. |
| `stateful_pvc_enabled` | `true` | Élevé | Un vrai PVC de blocs offre un verrouillage de fichier fiable ; le recours à GCS FUSE pour `/App/data` (en définissant ceci `false`) risque des conflits de verrouillage en cas d'écritures concurrentes. |
| `stateful_pvc_mount_path` | `/App/data` | Critique | Doit correspondre au répertoire de données réel de LubeLogger — un chemin incorrect signifie que la base de données et les téléchargements sont écrits dans un stockage de pod éphémère et perdus à chaque redémarrage. |
| `storage`/`dpkeys` buckets, ou le PVC | Ne jamais supprimer | Critique | La perte de `/App/data` (PVC ou bucket `storage`) entraîne la perte de tous les enregistrements de véhicules ; la perte de `dpkeys` invalide toutes les sessions de connexion existantes (récupérable — force uniquement la reconnexion). |
| `EnableAuth` | `true` (par défaut) | Critique | Le définir sur `false` rétablit le mode d'accès entièrement ouvert de LubeLogger — toute personne ayant l'URL peut consulter/modifier toutes les données sans aucune connexion. |
| Enregistrement initial | Terminer immédiatement après le déploiement | Élevé | Tant qu'un premier compte n'est pas enregistré, le formulaire d'inscription est accessible à toute personne pouvant atteindre l'URL. |
| `startup_probe`/`liveness_probe` chemin | `/Login` | Critique | Pointer les sondes vers `/` (ou tout chemin protégé par `[Authorize]`) fait échouer la sonde sur un pod par ailleurs sain — il ne devient jamais Prêt. |
| `workload_type` | laisser `null` (auto) | Élevé | La définition de `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` échoue au moment de la planification — un modèle de PVC nécessite un StatefulSet. |
| `database_type` | `NONE` (par défaut) | Élevé | Le mode par défaut de LubeLogger ignore entièrement ce paramètre ; le modifier ne connecte pas LubeLogger à une instance Cloud SQL — utilisez `POSTGRES_CONNECTION` à la place pour le chemin Postgres externe facultatif. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser le pod pendant la maintenance sans protection. |
| `service_type` | `LoadBalancer` (par défaut) | Moyen | Le définir sur `ClusterIP` rend l'interface utilisateur web publique inaccessible depuis l'extérieur du cluster. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à LubeLogger partagée
avec la variante Cloud Run est décrite dans
**[LubeLogger_Common](LubeLogger_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LubeLogger sur GKE Autopilot](../labs/LubeLogger_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LubeLogger sur Google Cloud Run](LubeLogger_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LubeLogger Common — Configuration d'application partagée](LubeLogger_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) dans la solution **Gestion de la maison et de la vie**.
