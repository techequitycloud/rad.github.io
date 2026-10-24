---
title: "Node-RED sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Node-RED sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/NodeRED_GKE.md @ e69407af sha256:4232361b2440 -->

# Node-RED sur GKE Autopilot {#node-red-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NodeRED_GKE.png" alt="Node-RED sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Node-RED est un outil de programmation open source basé sur les flux pour
connecter des appareils IoT, des API et des services en ligne via un éditeur
visuel basé sur un navigateur. Ce module déploie Node-RED sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Node-RED et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte NodeRED sur RAD, et comparaison {#what-nodered-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de NodeRED sur RAD coûte environ 37 à 110 $ US par
mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE
Autopilot convient à NodeRED qui doit rester opérationnel, s'adapter à
plusieurs pods ou fonctionner à côté d'autres charges de travail Kubernetes ;
pour le coût le plus bas, le [module Cloud Run](NodeRED_CloudRun.md) exécute le
même NodeRED pour environ 31 $ US par mois. Si vous n'en avez besoin
qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous
évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30
jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il
reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les
chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de
cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **NodeRED**, qui est open source, il n'y a donc pas de frais de
licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **37 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **61 crédits par jour**, environ 1 830 par mois (environ 183 $ US au prix de la recharge, 146 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte
qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5 vCPU / 0,5 GiB | 18,04 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 37 $ US** (environ 110 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comparaison {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour NodeRED lui-même**, la
  comparaison honnête est donc un serveur autogéré : un Hetzner CPX22 (2 vCPU/4
  Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24
  $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Il s'agit d'une charge de travail légère — une classe de VPS moins chère et
  plus petite que les boîtiers de référence ci-dessous ferait également
  l'affaire ; les chiffres sont présentés pour une comparaison à l'identique.
- Aucune offre SaaS gérée pour ce projet open source exact n'a pu être vérifiée
  avec un prix actuel et publié, donc aucun chiffre n'est donné ici. Node-RED
  est généralement exécuté aux côtés d'autres infrastructures d'automatisation
  plutôt que d'être acheté comme un abonnement autonome, de sorte que
  l'alternative réaliste est un petit VPS autogéré.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous
  qui appliquez les correctifs au système d'exploitation, faites pivoter les
  sauvegardes et maintenez la base de données (le cas échéant) en bonne santé.
  Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent cela pour
  vous, ce qui est le véritable argument en faveur de RAD par rapport à un
  boîtier moins cher — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si NodeRED s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à NodeRED dont vous n'avez besoin qu'occasionnellement
— une démo, une évaluation, un projet saisonnier — que de le faire fonctionner
en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas
  la VM, le cluster ou la ressource de calcul un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de restaurer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer
  que tout est revenu. Comme rien n'a été détruit individuellement, cette mise
  à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture plus jamais les frais
  de module. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 37 $ US.** Déployez NodeRED, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez
  terminé. Vous ne payez qu'une seule fois les frais de module, les builds et
  le temps pendant lequel NodeRED était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations d'étude et de
  démo conviennent). Google indique que la plupart des services sont à nouveau
  entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est
  donc très probable qu'il disparaisse dès que vous supprimez le projet — même
  si le projet lui-même est récupérable pendant 30 jours. Si vous avez
  personnalisé NodeRED et que vous souhaitez conserver ce travail, copiez une
  sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
  supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 45 crédits (4,50 $ US) dans votre propre projet, ou 41
  crédits dans un projet géré par RAD. La suppression permet d'économiser de
  l'argent une fois que NodeRED resterait inutilisé pendant environ 4 jours ou
  plus dans votre propre projet (environ 1,25 $ US par jour), ou environ 1 jour
  ou plus dans un projet géré par RAD (61 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données
  et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien
  d'autre dans le projet ne les utilise, de sorte que la suppression de NodeRED
  pendant que quelque chose d'autre partage le projet ne sauve que la partie
  calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant reçoit NodeRED dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire
  exécute NodeRED pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets
Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits
quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les
prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Node-RED s'exécute comme un conteneur Node.js écoutant sur le port 1880. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 500m CPU / 512 MiB par défaut, autoscalés horizontalement |
| Stockage de flux persistant | Filestore (NFS) | Flux, identifiants et nœuds installés dans `/data`, partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket de données d'application dédié |
| Stockage de contexte | Redis (optionnel) | Désactivé par défaut ; permet le partage de contexte entre les redémarrages et les instances |
| Secret d'identifiant | Secret Manager | `NODE_RED_CREDENTIAL_SECRET` auto-généré chiffre les identifiants de flux |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est requise.** Node-RED stocke tout l'état dans
  son répertoire `/data` ; `database_type` par défaut à `"NONE"`.
- **NFS est activé par défaut.** Le répertoire `/data` est monté à partir
  d'un partage Filestore afin que les flux, les identifiants et les nœuds
  installés survivent aux redémarrages de pods, à la resynchronisation et aux
  redéploiements. Tous les réplicas partagent les mêmes données.
- **`max_instance_count = 1` par défaut.** Node-RED n'est pas conçu pour la mise à l'échelle
  horizontale active-active — chaque instance a son propre contexte en mémoire.
  N'augmentez que si vous utilisez un stockage de contexte externe basé sur
  Redis.
- **L'affinité de session est `ClientIP`.** L'interface utilisateur de l'éditeur
  utilise des connexions WebSocket persistantes ; sans persistance, les
  sessions de navigateur se déconnectent à chaque requête qui est acheminée vers
  un pod différent.
- **`NODE_RED_CREDENTIAL_SECRET` est auto-généré.** Il chiffre tous les identifiants de flux
  stockés et est conservé dans Secret Manager. Le faire pivoter rend les
  identifiants existants illisibles — à manipuler avec précaution.
- **Les sondes de santé utilisent HTTP GET `/`**, qui renvoie l'interface
  utilisateur de l'éditeur une fois que Node-RED est entièrement démarré (un
  délai initial de 30 secondes est suffisant).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Node-RED {#a-gke-autopilot--the-node-red-workload}

Les pods Node-RED sont planifiés sur Autopilot, qui facture le CPU et la
mémoire que les pods demandent réellement. L'autoscaling horizontal des pods
dimensionne le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Node-RED pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Filestore (NFS) — stockage de flux persistant {#b-filestore-nfs--persistent-flow-storage}

Node-RED stocke toutes les données persistantes — flux (`flows.json`),
identifiants chiffrés (`flows_cred.json`), nœuds de palette installés et fichier de
paramètres — dans son répertoire `/data`. Un partage NFS de Cloud Filestore
est monté à `/data` afin que ces données survivent aux redémarrages de pods,
à la resynchronisation et aux redéploiements. Tous les réplicas partagent les
mêmes données.

- **Console :** Filestore → Instances pour le partage NFS.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, la sauvegarde et les
options CMEK.

### C. Cloud Storage {#c-cloud-storage}

Un bucket GCS dédié est provisionné pour les données d'application Node-RED
(exportations de flux, archives de sauvegarde). Le compte de service de la
charge de travail se voit accorder un accès automatique.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK.

### D. Secret Manager — chiffrement des identifiants de flux {#d-secret-manager--flow-credential-encryption}

`NODE_RED_CREDENTIAL_SECRET` est généré automatiquement lors du déploiement et stocké
comme un secret Secret Manager. Node-RED utilise cette clé pour chiffrer tous
les identifiants stockés dans les flux. Aucun autre secret spécifique à
l'application n'est généré par ce module.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### E. Redis (stockage de contexte optionnel) {#e-redis-optional-context-storage}

Lorsque `enable_redis = true`, Node-RED est configuré pour stocker le contexte de flux
en externe dans Redis, permettant aux données de contexte de persister après les
redémarrages de pods et d'être partagées entre plusieurs instances. Redis est
désactivé par défaut.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

Lorsque `enable_redis = true` et `redis_host` est vide, l'adresse IP du serveur NFS est
utilisée comme hôte Redis. Si NFS est également désactivé, `redis_host` doit être
défini explicitement.

### F. Réseau et ingress {#f-networking--ingress}

La charge de travail est exposée via une adresse IP externe de Cloud Load
Balancing. `enable_custom_domain` par défaut à `true`, provisionnant un Ingress
Kubernetes avec un certificat géré par Google pour les noms d'hôte dans
`application_domains` ; une adresse IP statique est réservée par défaut afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Node-RED {#3-node-red-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Node-RED stocke
  tout l'état dans son répertoire `/data`. Aucune instance Cloud SQL n'est
  provisionnée et aucun job d'initialisation de schéma n'est requis. Le premier
  démarrage crée automatiquement les fichiers de flux par défaut si `/data`
  est vide.
- **Chiffrement des identifiants de flux.** `NODE_RED_CREDENTIAL_SECRET` est injecté au
  moment de l'exécution depuis Secret Manager. Cette clé chiffre le fichier
  `flows_cred.json` sur le partage NFS. La modification ou la rotation de la clé après
  le déploiement des flux rend tous les identifiants stockés (clés API, mots de
  passe, jetons) illisibles.
- **Mode sécurisé.** `NODE_RED_ENABLE_SAFE_MODE` est toujours défini sur `"false"`,
  garantissant l'exécution des flux au démarrage. Remplacez-le par `"true"`
  via `environment_variables` pour démarrer Node-RED avec les flux désactivés pour le
  débogage.
- **Sessions d'éditeur WebSocket.** L'éditeur Node-RED communique via des
  connexions WebSocket persistantes. L'affinité de session (`ClientIP`) est
  requise pour que les sessions d'éditeur soient acheminées vers le même pod ;
  sans elle, les opérations de déploiement échouent avec des déconnexions
  WebSocket.
- **Sonde de santé.** Les sondes de démarrage et de vivacité envoient toutes
  deux des requêtes HTTP GET à `/`, qui renvoie l'interface utilisateur
  de l'éditeur une fois que Node-RED est prêt. Un délai initial de 30 secondes
  est suffisant pour un démarrage standard.
- **Tâches planifiées et CronJobs.** Node-RED n'a pas de commandes planifiées
  intégrées. Utilisez `cron_jobs` pour provisionner des CronJobs Kubernetes pour
  les tâches de maintenance périodiques telles que les exportations de flux ou
  les vidages de cache :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Accéder à l'éditeur.** Naviguez vers la sortie `service_url` et connectez-vous.
  Pour les déploiements de production, activez IAP (`enable_iap = true`) pour contrôler
  l'accès avec l'authentification Google Identity.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Node-RED sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nodered` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Node-RED` | Nom convivial affiché dans la console et les tableaux de bord. |
| `application_description` | `Node-RED - Flow-based programming for IoT and event automation` | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag d'image pour `nodered/node-red`. Épinglez à une version spécifique (par exemple `4.0.9`) pour des déploiements reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Utilisez `"prebuilt"` pour l'image officielle Docker Hub ; `"custom"` pour construire via Cloud Build. |
| `container_image` | `nodered/node-red:latest` | URI d'image complet lorsque `container_image_source = "prebuilt"`. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire. Node-RED est léger ; accepte également les options `cpu_request`, `mem_request`, `ephemeral_storage_limit`, `ephemeral_storage_request`. |
| `container_port` | `1880` | Port HTTP natif de Node-RED. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (doit être ≥ 1 pour GKE). |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Conservez à `1` sauf si vous utilisez un stockage de contexte externe basé sur Redis. |
| `enable_image_mirroring` | `true` | Mettre en miroir depuis Docker Hub vers Artifact Registry pour éviter les limites de débit. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les requêtes de ressources. |
| `timeout_seconds` | `300` | Temps d'attente maximal du backend de l'équilibreur de charge (secondes). |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `NODE_RED_CREDENTIAL_SECRET` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les connexions WebSocket de l'éditeur Node-RED. |
| `namespace_name` | `""` | Auto-généré à partir de `application_name` et `tenant_id` lorsqu'il est vide. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` ; sinon `Deployment`. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité du pare-feu NFS — ne pas supprimer lorsque `enable_nfs = true`. |

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC par pod. La définition à `true` sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage — défini sur `/data` pour sauvegarder le répertoire de données de Node-RED avec un PVC dédié. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/`, 30s delay | Sonde HTTP contre le chemin de l'éditeur Node-RED. |
| `health_check_config` | HTTP `/`, 30s delay | Sonde de vivacité — redémarre le conteneur si l'éditeur ne répond pas. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring optionnelle. Désactivée par défaut ; activez-la pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Node-RED ne nécessite pas de jobs d'initialisation. Fournissez des jobs personnalisés pour les importations de flux ou les installations de palettes. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour les tâches de maintenance périodiques. |
| `additional_services` | `[]` | Déploiements Kubernetes supplémentaires déployés avec Node-RED. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le répertoire `/data` de Node-RED. Fortement recommandé. |
| `nfs_mount_path` | `/data` | Doit correspondre au répertoire de données de Node-RED. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto)_ | Nom de la VM NFS existante ou nom de base pour une VM intégrée. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. `NodeRED_Common` ajoute automatiquement un bucket `nodered-storage`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Stockage de contexte Redis {#group-15--redis-context-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour le stockage de contexte Node-RED. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true` (sauf si `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Secret d'identifiant et base de données {#group-16--credential-secret--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du `NODE_RED_CREDENTIAL_SECRET` auto-généré (16–64). |
| `database_type` | `NONE` | Node-RED ne nécessite pas de base de données. Ne pas modifier. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du secret d'identifiant. La rotation de la clé rend les identifiants de flux existants illisibles. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde NFS automatisé (UTC). Laissez vide pour désactiver. |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité du pare-feu NFS. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Node-RED. Fortement recommandé pour la production — l'éditeur expose l'édition complète des flux. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend Ingress. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Node-RED. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors de la première application d'un nouveau cluster intégré — une deuxième application est requise. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Sans NFS, tous les flux, identifiants et nœuds installés sont perdus à chaque redémarrage ou événement de resynchronisation de pod. |
| `NODE_RED_CREDENTIAL_SECRET` (de `database_password_length`) | auto-généré | Critique | Chiffre tous les identifiants de flux. La rotation ou la modification de la clé après le déploiement des flux rend les identifiants existants illisibles de manière permanente. |
| `enable_auto_password_rotation` | `false` | Critique | La rotation automatique modifie la clé de chiffrement ; tous les identifiants de flux stockés deviennent inaccessibles. N'activez qu'avec une procédure de rechiffrement en place. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée toutes les ressources GCP et Kubernetes et déconnecte le partage NFS. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide échoue au job de restauration. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification de pod. |
| `max_instance_count` | `1` | Élevé | Node-RED n'est pas conçu pour la mise à l'échelle active-active. Plusieurs instances sans contexte partagé entraînent un état conflictuel. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, le WebSocket de l'éditeur se déconnecte et les opérations de déploiement échouent. |
| `nfs_mount_path` | `/data` | Élevé | Doit correspondre au répertoire de données natif de Node-RED. Le modifier sans mettre à jour le fichier de paramètres achemine les écritures vers un stockage éphémère. |
| `execution_environment` (Cloud Run uniquement) | `gen2` | Élevé | Les montages NFS nécessitent la génération 2. |
| `database_type` | `NONE` | Élevé | La définition à `MYSQL` ou `POSTGRES` provisionne une instance Cloud SQL et un sidecar proxy que Node-RED n'utilise pas. |
| `enable_redis` sans `redis_host` | définir `redis_host` explicitement | Élevé | Avec NFS désactivé et sans hôte Redis, la chaîne de connexion Redis est vide et le stockage de contexte échoue. |
| `enable_iap` | `true` pour la production | Élevé | L'éditeur Node-RED expose l'édition complète des flux et la gestion des identifiants ; il ne doit pas être laissé publiquement accessible. |
| `min_instance_count` | `1` | Moyen | GKE ne prend pas en charge la mise à l'échelle à zéro sans KEDA. Le HPA rejette `min > max`. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation de PDB permet à GKE d'expulser le pod pendant la maintenance du nœud, ce qui entraîne une panne complète et une perte de données potentielle si une écriture NFS était en cours. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Node-RED
partagée avec la variante Cloud Run est décrite dans
**[NodeRED_Common](NodeRED_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : NodeRED sur GKE Autopilot](../labs/NodeRED_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Node-RED sur Google Cloud Run](NodeRED_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [NodeRED Common — Configuration d'application partagée](NodeRED_Common.md) — la configuration partagée par les deux cibles de déploiement.
