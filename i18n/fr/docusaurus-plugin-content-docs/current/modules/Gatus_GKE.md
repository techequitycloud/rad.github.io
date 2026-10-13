---
title: "Gatus sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Gatus sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gatus_GKE.md @ e69407af sha256:ab4f31ccbacb -->

# Gatus sur GKE Autopilot {#gatus-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gatus_GKE.png" alt="Gatus sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gatus est un moniteur de page d'état et de contrôle de santé open-source, sous
licence Apache 2.0, orienté développeur et écrit en Go. Il interroge les
points de terminaison HTTP, TCP, DNS, ICMP et autres configurés selon des
calendriers indépendants par point de terminaison, évalue des conditions de
résultat simples (code d'état, temps de réponse, contenu du corps de la
réponse, expiration du certificat TLS) et sert une page d'état publique en
direct ainsi que des alertes — aucune base de données externe n'est requise.
Ce module déploie Gatus sur **GKE Autopilot** sur la base de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Gatus utilise et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Gatus sur RAD, et comment cela se compare {#what-gatus-costs-on-rad-and-how-that-compares}

**L'exécution de Gatus dans votre propre projet Google Cloud coûte environ 40,29 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique de 40 crédits** (36 crédits — 10 % de moins — dans un projet géré par RAD). Gatus est une page d'état et un moniteur de contrôle de santé auto-hébergés, orientés développeur (Go). Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Gatus est également disponible sur Cloud Run — voir le [guide Cloud Run](Gatus_CloudRun.md) pour l'option à moindre coût ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **40 crédits** (une fois) | **36 crédits** (une fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une fois, par build) | ~3–6 crédits (une fois, par build) |
| Coût d'exécution Google Cloud | ~40,29 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~63 crédits/jour (~6,30 $ US/jour), mesuré à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 0,5 GiB | 34,29 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **40,29 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officiellement hébergée/cloud de Gatus pour comparer, donc la comparaison honnête est avec une infrastructure auto-gérée, pas un SaaS concurrent.
- Un VPS nu dimensionné à environ 1 vCPU / 0,5 GiB — un Hetzner CPX22 (2 vCPU/4 Go, ~24 $ US/mois), un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois), ou le propre Compute Engine e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois) — est généralement moins cher que le prix affiché de RAD ; un VPS d'une ou deux tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le système d'exploitation, faire tourner les sauvegardes de base de données, renouveler les certificats TLS et surveiller les temps d'arrêt. Cloud SQL géré par RAD, Secret Manager et la surveillance le font pour vous, ce qui est le véritable compromis, pas le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Gatus est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire.
La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet —
la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression du module Gatus seul, cela ne
détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est
facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher
son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que
rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits de temps de build
au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne de déploiement typique de 2 à 3. Les frais de module de 36 crédits
ne sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même
dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau
projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si
le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Gatus et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut
sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Gatus se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **40 + ~3–6 crédits** (~4,45 $ US) dans votre propre projet, ou **36 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Gatus reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution : environ **4 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 40,29 $ US/mois), ou **environ 1 jour ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses environ 63 crédits/jour).

Priorité aux données : les sauvegardes nocturnes sont stockées dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci. Copiez donc la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est mise en pause et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Gatus s'exécute comme une seule charge de travail web Go. Le déploiement relie
un ensemble délibérément restreint de services Google Cloud — Gatus n'a pas
de dépendance de base de données, de cache ou de stockage d'objets propre :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiement Go unique, 1 vCPU / 512 Mio par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; le magasin d'historique optionnel est un fichier SQLite local, aucun Cloud SQL n'est provisionné |
| Persistance | Disque éphémère (par défaut), NFS ou PVC de bloc (StatefulSet) | Historique SQLite à `/data/data.db` ; le PVC de bloc est la seule option vérifiée comme sûre pour le SQLite en mode WAL de Gatus (voir ci-dessous) |
| Stockage d'objets | **Aucun** | Gatus ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; Gatus n'a pas de dépendance de cache ou de file d'attente |
| Secrets | Secret Manager | Pas de secrets auto-générés ; seulement `secret_environment_variables` fournis par l'utilisateur |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — le magasin d'historique optionnel de Gatus est un fichier SQLite local. Les variables liées à la base de données existent pour être complètes mais sont inertes à moins que vous n'optiez délibérément pour une base de données externe.
- **La configuration est entièrement basée sur des fichiers.** Chaque point de terminaison surveillé, intégration d'alerte et paramètre de stockage se trouve dans un fichier YAML intégré à l'image au moment de la construction — il n'y a pas de convention de variable d'environnement par paramètre et pas d'API de rechargement de configuration à l'exécution. Modifiez les points de terminaison surveillés en éditant `modules/Gatus_Common/scripts/config.yaml` et en redéployant.
- **Déploiement sans état par défaut, avec la SEULE option de durabilité réellement sûre dans ce catalogue.** `workload_type = "Deployment"` avec un magasin d'historique SQLite **éphémère** à `/data/data.db`. Gatus code en dur le mode journal WAL de SQLite (confirmé en direct : aucune option de configuration ne le désactive), et la propre documentation de SQLite indique que WAL n'est pas pris en charge sur les systèmes de fichiers réseau — donc NFS présente un risque réel de corruption ici. Le `stateful_pvc_enabled = true` de GKE (un véritable périphérique de bloc, pas gcsfuse) est le chemin recommandé pour un historique durable : associez-le à `stateful_pvc_storage_class = "standard"` (HDD ; l'historique de Gatus n'a pas besoin d'IOPS SSD, et le HDD évite le quota régional strict `SSD_TOTAL_GB`).
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`). Plusieurs réplicas interrogeraient chacun indépendamment chaque point de terminaison et dupliqueraient les alertes — il n'y a pas de coordination partagée entre les instances Gatus.
- **Exposé via un service LoadBalancer** (`service_type = "LoadBalancer"`) afin que la page d'état soit accessible depuis l'extérieur du cluster ; `reserve_static_ip` et `enable_custom_domain` sont tous deux par défaut à `false` car Gatus n'intègre aucune URL auto-référente dans sa configuration au démarrage — n'activez l'un ou l'autre que si vous avez besoin d'une IP stable ou d'un nom d'hôte personnalisé.
- **Le point de terminaison de santé est `/health`**, qui renvoie HTTP 200 dès que le serveur lie son port.
- **Pour fonctionner aux côtés de `Gatus_CloudRun` sur le même locataire**, définissez `tenant_id = "gke"` (et `"cr"` sur la variante Cloud Run) — voir la recommandation dans `config/deploy.tfvars`. Cela évite une collision de noms sur les noms de secrets partagés, les noms de buckets GCS et les sujets de rotation.
- **Le contrôle d'accès, le cas échéant, est configuré dans `config.yaml`.** Gatus est livré avec une page d'état ouverte par défaut ; une protection optionnelle par authentification de base ou OIDC est configurée dans le bloc `security` de `config.yaml` et nécessite une reconstruction.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Gatus {#a-gke-autopilot--the-gatus-workload}

Les pods Gatus sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Par défaut, la charge de travail est un `Deployment` sans état avec un seul
réplica ; le passage à un `StatefulSet` provisionne un PVC de bloc par pod pour un historique
de vérification durable.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Gatus pour voir les pods
  et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Déploiement vs StatefulSet) sont gérés.

### B. Persistance — le magasin d'historique SQLite {#b-persistence--the-sqlite-history-store}

Gatus n'a **pas d'instance Cloud SQL**. Son magasin d'historique optionnel est un fichier SQLite local
à `/data/data.db`, intégré à la structure de répertoires de l'image. Avec le
déploiement sans état par défaut, ce répertoire est **éphémère** — l'historique ne
survit pas à un redémarrage de pod.

- **PVC de bloc StatefulSet (recommandé pour un historique durable) :**
  `stateful_pvc_enabled = true` avec `stateful_pvc_mount_path = "/data"` et
  `stateful_pvc_storage_class = "standard"` — un périphérique de bloc réel par pod contient la
  base de données d'historique. C'est la seule option de persistance de ce catalogue vérifiée
  comme sûre pour le fichier SQLite en mode WAL de Gatus.
- **NFS (Filestore) — à utiliser avec prudence :** `enable_nfs = true` se monte à `/data`, mais
  comporte le risque WAL-sur-système-de-fichiers-réseau décrit au §1.

- **Console :** Filestore → Instances (NFS) ; Kubernetes Engine → Stockage →
  PersistentVolumeClaims (PVC de bloc).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                             # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /data           # history store location
  ```

Voir [App_GKE](App_GKE.md) pour les modèles NFS et StatefulSet PVC.

### C. Secret Manager {#c-secret-manager}

Gatus ne génère **aucun** secret au moment du déploiement — il n'y a pas de mot de passe de base de données ou
de clé de chiffrement à gérer. Secret Manager n'est utilisé que si vous fournissez le vôtre via
`secret_environment_variables` (par exemple un `${VAR}` référencé dans
la configuration d'alerte de `config.yaml`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing via un
service LoadBalancer. Un domaine personnalisé avec un certificat géré par Google et une
adresse IP statique réservée peuvent tous deux être activés si nécessaire, mais aucun n'est requis pour
la correction puisque la configuration de Gatus n'intègre aucune URL auto-référente.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles. Gatus enregistre le résultat de chaque
vérification de point de terminaison (succès/échec, durée) au fur et à mesure de son exécution.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gatus {#3-gatus-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Gatus n'a pas de base de données externe et pas d'étape de migration. Il lit `config.yaml`, initialise son magasin d'historique SQLite (si configuré) et commence à servir immédiatement. Il n'y a pas de job d'initialisation par défaut.
- **La persistance dépend du type de charge de travail.** Un `Deployment` sans état utilise un magasin d'historique éphémère ; un `StatefulSet` avec un PVC de bloc le rend durable après les redémarrages de pod.
- **`imagePullPolicy = Always` pour l'image personnalisée.** App_GKE le définit pour les images personnalisées/miroirs afin qu'une reconstruction et un redéploiement sous une balise inchangée tirent les nouvelles couches plutôt que de servir un cache de nœud obsolète.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health`, qui renvoie HTTP 200 dès que le serveur lie le port 8080. Vérifiez depuis l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s -o /dev/null -w '%{http_code}\n' http://<service-name>.$NAMESPACE.svc.cluster.local/health
  ```
- **Afficher la page d'état** (par rapport à l'IP externe) :
  ```bash
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  curl -s "http://$EXTERNAL_IP/" | head -20
  ```
- **Les modifications de configuration nécessitent une reconstruction.** Gatus n'a pas d'interface utilisateur d'administration ou d'API pour modifier les points de terminaison surveillés. Modifiez `modules/Gatus_Common/scripts/config.yaml` (ajoutez, supprimez ou modifiez les entrées `endpoints`) et redéployez pour appliquer les modifications.
- **L'accès est ouvert jusqu'à ce que vous le configuriez.** Par défaut, la page d'état n'a pas d'authentification. Configurez l'authentification de base ou OIDC dans le bloc `config.yaml` de `security` et redéployez pour restreindre la visualisation.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Gatus sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; définissez `"gke"` pour coexister avec un déploiement `Gatus_CloudRun` sur le même locataire (voir `config/deploy.tfvars`). |
| `application_name` | `gatus` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` correspond à une base `v5.36.0` épinglée. Épinglez `v5.x.y` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build ; `prebuilt` déploie une image directement. |
| `min_instance_count` | `1` | Réplicas minimum (GKE n'a pas de mise à l'échelle à zéro). |
| `max_instance_count` | `1` | **Gardez à 1** — chaque réplica interrogerait indépendamment chaque point de terminaison et dupliquerait les alertes. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/mémoire par pod. |
| `container_port` | `8080` | Gatus écoute sur le port 8080. |
| `container_protocol` | `http1` | HTTP/1.1 par défaut. |
| `workload_type` | `Deployment` | Par défaut sans état ; `StatefulSet` pour un PVC durable par pod. |
| `enable_cloudsql_volume` | `false` | Désactivé — Gatus n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Gatus dans Artifact Registry. |

### Groupe 5 — Proxy conscient de l'identité (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la visualisation non authentifiée.** Nécessite `iap_oauth_client_id` / `_secret`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Substitutions pour les références de type `${VAR}` dans `config.yaml`, pas des remplacements par paramètre. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager (facultatif ; aucun n'est requis). |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laisser vide pour découvrir automatiquement le cluster Services_GCP. |
| `service_type` | `LoadBalancer` | Gatus est une page d'état publique, donc cela est par défaut à `LoadBalancer`. |
| `session_affinity` | `None` | Définissez `ClientIP` si vous mettez à l'échelle les réplicas et que vous souhaitez un client épinglé. |

### Groupe 7 — StatefulSet (historique de vérification durable) {#group-7--statefulset-durable-check-history}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC de bloc par pod — la seule option durable vérifiée comme sûre pour l'historique SQLite en mode WAL de Gatus. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage ; correspond au répertoire `storage.path` intégré à `config.yaml`. |
| `stateful_pvc_storage_class` | `standard` | HDD par défaut — le magasin d'historique de Gatus n'a pas besoin d'IOPS SSD ; évite le quota strict `SSD_TOTAL_GB`. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage. Gatus devient sain en quelques secondes. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 13 / 14 — Système de fichiers et Cloud Storage {#group-13--14--filesystem--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Montage d'historique durable facultatif. **Attention :** comporte un risque WAL-sur-système-de-fichiers-réseau — préférez `stateful_pvc_enabled`. |
| `nfs_mount_path` | `/data` | Chemin de montage NFS ; correspond au `storage.path` intégré de Gatus. |
| `storage_buckets` | `[]` | Non requis — Gatus n'utilise pas de stockage d'objets. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Gatus n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `gatus` | Inerte à moins qu'une base de données externe ne soit délibérément activée. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — Gatus n'a pas de dépendance Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provisionner un Ingress pour un nom d'hôte personnalisé + certificat géré. Désactivé par défaut — le service `LoadBalancer` offre déjà une accessibilité externe. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `false` | Désactivé par défaut — Gatus n'intègre aucune URL auto-référente, il n'y a donc aucune raison de réserver une IP stable pour la correction. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `service_url` | URL pour atteindre Gatus. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (aucun par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`, `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. Le propre `validation.tf` de la variante GKE applique ces protections. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (pour l'historique durable) | Préférer `stateful_pvc_enabled` à la place | Critique | Gatus code en dur le mode journal WAL de SQLite, que la propre documentation de SQLite déclare non pris en charge sur les systèmes de fichiers réseau — l'historique sauvegardé par NFS risque une corruption silencieuse au fil du temps. |
| `stateful_pvc_mount_path` | `/data` | Élevé | Monter le PVC ailleurs que dans le répertoire `storage.path` intégré de Gatus persiste le mauvais chemin et l'historique reste éphémère. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Moyen | Le défaut basé sur SSD (`standard-rwo`) réduit le quota régional strict `SSD_TOTAL_GB` pour une charge de travail qui n'a pas besoin d'IOPS SSD. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 fait que chaque réplica interroge indépendamment chaque point de terminaison, dupliquant les notifications d'alerte sans coordination entre les instances. |
| `enable_cloudsql_volume` | `false` | Élevé | Définir `true` avec `database_type = "NONE"` démarre un sidecar de proxy d'authentification sans instance à atteindre — rejeté par la protection au moment de la planification. |
| `enable_iap` | uniquement lorsque l'authentification est activée | Élevé | IAP exige la connexion Google pour chaque requête, bloquant la visualisation non authentifiée de la page d'état. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la protection de validation rejette les valeurs invalides, et 0 ne laisserait aucun pod pour servir la page d'état. |
| Bloc `security` de Gatus dans `config.yaml` | Configurer si la page contient des noms de points de terminaison sensibles | Moyen | Par défaut, la page d'état (y compris tous les noms de points de terminaison configurés et leur historique de disponibilité/indisponibilité) est visible publiquement par toute personne disposant de l'IP externe. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `application_version` | Épinglez `v5.x.y` en production | Faible | `latest` correspond à une base épinglée (`v5.36.0`) ; épinglez explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
mise à l'échelle automatique, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Gatus partagée avec la variante Cloud Run est
décrite dans **[Gatus_Common](Gatus_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gatus sur GKE Autopilot](../labs/Gatus_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gatus sur Google Cloud Run](Gatus_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gatus Common — Configuration d'application partagée](Gatus_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Headscale sur GKE Autopilot](Headscale_GKE.md), [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md), [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md) dans la solution **Réseau Zero-trust et DNS**.
