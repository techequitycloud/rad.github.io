---
title: "TechnitiumDNS sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de TechnitiumDNS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/TechnitiumDNS_GKE.md @ e69407af sha256:57a5342ae670 -->

# TechnitiumDNS sur GKE Autopilot {#technitiumdns-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/TechnitiumDNS_GKE.png" alt="TechnitiumDNS sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **Divulgation de la portée :** ce module déploie **uniquement la console d'administration web + l'API REST** de Technitium
> (port 5380/HTTP). La fonction de résolveur DNS principale de Technitium (port 53/udp+tcp) **ne peut pas** être exposée
> via le modèle de passerelle HTTP(S) standard de ce module — aucun équilibreur de charge L4 UDP/TCP port-53 brut n'est
> provisionné. Aucun client ne peut interroger ce déploiement en tant que résolveur DNS. Voir les §1 et §7 ci-dessous pour
> l'explication complète.

Technitium DNS Server est un serveur DNS autoritaire et récursif auto-hébergé, open-source, multiplateforme
(.NET) avec une console d'administration web complète et une API REST pour la gestion des zones, des enregistrements,
le blocage des publicités/traqueurs basé sur DNS, le transfert conditionnel et le DNS-over-HTTPS/TLS. Ce module déploie l'image officielle `technitium/dns-server`
sur **GKE Autopilot**, sans modification, sur la base de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par TechnitiumDNS et sur la manière de les explorer et de les exploiter depuis la
console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## Ce que coûte TechnitiumDNS sur RAD, et comment cela se compare {#what-technitiumdns-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de TechnitiumDNS sur RAD coûte environ 24,04 $ US par mois dans un projet Google Cloud que vous possédez, avec les frais de module facturés une seule fois en crédits RAD.** GKE convient à ce module s'il doit être placé à côté d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](TechnitiumDNS_CloudRun.md) exécute le même déploiement pour environ 16,78 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — pour tester la configuration de zone, une évaluation de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **24,04 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **55 crédits par jour**, soit environ 1 650 par mois |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, le réseau est partagé par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ressources réseau.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5 vCPU / 0,5 GiB | 18,04 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **24,04 $ US** |

### Comment cela se compare {#how-it-compares}

- TechnitiumDNS n'a pas de SaaS commercial hébergé pour cette interface d'administration/API — il est distribué uniquement en tant que logiciel open-source auto-hébergé, Docker-first, pour qu'un administrateur puisse l'exécuter lui-même.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — toutes ces machines sont plus puissantes que le pod de 0,5 vCPU / 0,5 GiB de ce module ; une micro-instance à vCPU partagé de 5-6 $/mois l'exécuterait confortablement, plus le temps de l'administrateur pour les correctifs et le TLS que Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- Sans base de données ici, la majeure partie du coût d'exécution du projet RAD au-delà du pod lui-même est le coût de gestion du cluster GKE partagé, qui est réparti entre toutes les applications GKE exécutées dans le même projet.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si TechnitiumDNS s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne détruit pas la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de 2-3 déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez une configuration de zone personnalisée que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer TechnitiumDNS purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 45 crédits (environ 4,50 $ US) dans votre propre projet, ou 41 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si TechnitiumDNS reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus (environ 0,80 $ US par jour), cela représente environ 6 jours ou plus, ou environ 1 jour ou plus dans un projet géré par RAD (55 crédits par jour). Il n'y a pas de base de données ici, donc la suppression de cette application libère son coût d'exécution total plutôt qu'une simple part de celui-ci — seuls les frais de cluster partagés, le cas échéant, continuent de fonctionner pour les autres applications.

Gardez les données en premier : tout ce que TechnitiumDNS écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui, alors copiez tout ce que vous voulez conserver avant de le supprimer.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de laboratoire, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Aucun SaaS commercial hébergé actuellement vérifié n'existe pour cette surface TechnitiumDNS, donc aucun prix concurrent n'est mentionné.

## 1. Vue d'ensemble {#1-overview}

TechnitiumDNS s'exécute comme une seule charge de travail web pré-construite. Le déploiement connecte un ensemble délibérément restreint de services Google Cloud — TechnitiumDNS n'a pas de dépendance de base de données ou de cache propre :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiement unique, 500m vCPU / 512 MiB par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; les zones/paramètres/journaux sont des fichiers plats locaux, aucune base de données Cloud SQL n'est provisionnée |
| Persistance | Cloud Storage (GCS FUSE, par défaut) ou PVC de bloc (StatefulSet) | Bucket de configuration monté à `/etc/dns` ; passer à un PVC de bloc StatefulSet pour un véritable périphérique de bloc |
| Stockage d'objets | Cloud Storage | Un bucket "config" auto-créé (également la couche de persistance ci-dessus) |
| Cache / file d'attente | **Aucune** | Pas de Redis ; TechnitiumDNS n'a pas besoin de cache externe |
| Secrets | Secret Manager | Un secret auto-généré : `DNS_SERVER_ADMIN_PASSWORD` |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe (console web uniquement) ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — TechnitiumDNS conserve les zones, les paramètres et
  les journaux sous forme de fichiers plats locaux sous `/etc/dns`. Les variables liées à la base de données existent pour être complètes mais
  sont inertes.
- **Persistant par défaut via GCS FUSE.** `workload_type = "Deployment"` avec un volume monté sur GCS à
  `/etc/dns` — la configuration survit aux redémarrages de pod. Passez à un **PVC de bloc StatefulSet**
  (`stateful_pvc_enabled = true` avec `stateful_pvc_mount_path = "/etc/dns"`) pour un véritable périphérique de bloc
  avec des garanties de verrouillage d'écriture plus fortes ; le module désactive automatiquement le volume GCS dans ce cas.
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`) — une console d'administration à faible trafic
  n'a pas besoin d'une mise à l'échelle horizontale.
- **Exposé via un service LoadBalancer** (`service_type = "LoadBalancer"`) avec une IP **éphémère**
  (`reserve_static_ip = false`) par défaut, conservant le quota d'IP statiques souvent rares du projet — la
  console n'intègre pas d'URL auto-référente dans sa configuration de démarrage.
- **Le point de terminaison de santé est `/`**, la page racine non authentifiée de la console, qui renvoie HTTP 200 avec
  le HTML complet de la console dès que le serveur lie son port.
- **La variante GKE s'exécute sur son propre espace de noms de locataire.** Donnez à `TechnitiumDNS_GKE` un
  `tenant_id` distinct (par exemple `"gke"`) si déployé à côté de `TechnitiumDNS_CloudRun` sur le même
  locataire, pour éviter une collision de noms.
- **Un secret auto-généré.** `DNS_SERVER_ADMIN_PASSWORD` amorce le compte `admin` initial uniquement lors du
  tout premier démarrage ; les redémarrages ultérieurs l'ignorent.
- **Pas de résolveur DNS.** Voir le §7 ci-dessous — c'est la chose la plus importante à comprendre avant
  de déployer ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés
dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail TechnitiumDNS {#a-gke-autopilot--the-technitiumdns-workload}

Les pods TechnitiumDNS sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement.
Par défaut, la charge de travail est un `Deployment` sans état avec un seul réplica ; le passage à un `StatefulSet`
provisionne un PVC de bloc par pod pour un véritable périphérique de bloc à `/etc/dns`.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail TechnitiumDNS pour voir les pods et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Persistance — le bucket Cloud Storage de configuration (ou PVC de bloc) {#b-persistence--the-config-cloud-storage-bucket-or-block-pvc}

TechnitiumDNS n'a **pas d'instance Cloud SQL**. Toutes les zones, les paramètres, la base de données d'authentification et les journaux se trouvent sous
`/etc/dns`. Par défaut, cela est sauvegardé par un bucket Cloud Storage monté via GCS FUSE ; passez à un PVC de bloc StatefulSet
pour un véritable périphérique de bloc :

- **Console :** Cloud Storage → Buckets (volume GCS) ; Kubernetes Engine → Stockage → PersistentVolumeClaims
  (PVC de bloc).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-config"
  kubectl get pvc -n "$NAMESPACE"                                # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /etc/dns           # config/zone location
  ```

Voir [App_GKE](App_GKE.md) pour le pilote CSI GCS FUSE et les modèles de PVC StatefulSet.

### C. Secret Manager {#c-secret-manager}

TechnitiumDNS génère exactement un secret au moment du déploiement : le mot de passe administrateur initial.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing via un service LoadBalancer — il s'agit de la **console web**, et non d'un point de terminaison DNS. Un domaine personnalisé avec un certificat géré par Google peut être activé pour la console ; une IP statique n'est PAS réservée par défaut (définissez `reserve_static_ip = true` pour une adresse stable lors des redéploiements).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application TechnitiumDNS {#3-technitiumdns-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** TechnitiumDNS n'a pas de base de données externe et pas d'étape de migration. Il
  lit/écrit des fichiers plats locaux sous `/etc/dns` dès son démarrage.
- **Amorçage de l'administrateur au premier démarrage.** `DNS_SERVER_ADMIN_PASSWORD` est appliqué uniquement lorsque
  `/etc/dns/auth.config` n'existe pas encore. Lors de chaque redémarrage ou redéploiement ultérieur, le
  `auth.config` persistant l'emporte.
- **`imagePullPolicy = Always` n'est PAS forcé pour ce module** — l'image est tirée fraîchement (pré-construite,
  résolue par digest) plutôt qu'une balise construite/miroir personnalisée, donc la préoccupation de cache obsolète d'App_GKE pour les images reconstruites
  ne s'applique pas ici de la même manière ; une mise à jour de version nécessite toujours un nouveau `application_version`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui renvoie HTTP 200 avec le HTML complet de la console
  dès que le serveur lie le port 5380. Vérifiez depuis l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
    http://<service-name>.$NAMESPACE.svc.cluster.local/
  ```
- **Connectez-vous.** Accédez à l'IP/nom d'hôte externe dans un navigateur, connectez-vous en tant que `admin` avec le mot de passe de Secret-Manager,
  et changez-le immédiatement depuis la page de gestion des utilisateurs de la console (Technitium ne relit pas
  `DNS_SERVER_ADMIN_PASSWORD` après le premier démarrage).
- **API REST.** Toutes les actions de la console sont également disponibles via l'API REST en utilisant un jeton de session obtenu
  via `/api/user/login`. Voir
  [la documentation de l'API de Technitium](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md).
- **Pas de résolution DNS à partir de ce déploiement.** Voir le §7 ci-dessous.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou
notables pour TechnitiumDNS sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son
comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; utilisez une valeur distincte (par exemple `"gke"`) à côté de la variante CloudRun sur le même locataire. |
| `application_name` | `technitiumdns` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise de version de l'image TechnitiumDNS (par exemple `latest`, `13.5.1`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle telle quelle ; `custom` accepté pour la compatibilité ascendante. |
| `min_instance_count` | `1` | Réplicas minimum (GKE n'a pas de mise à l'échelle à zéro pour les déploiements). |
| `max_instance_count` | `1` | Réplicas maximum. |
| `container_resources` | `{ cpu_limit="500m", memory_limit="512Mi" }` | CPU/mémoire par pod. |
| `container_port` | `5380` | Port par défaut de la console web. |
| `workload_type` | `Deployment` | Par défaut sans état ; `StatefulSet` pour un PVC de bloc durable par pod. |
| `enable_cloudsql_volume` | `false` | Désactivé — TechnitiumDNS n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image TechnitiumDNS dans Artifact Registry. |

### Groupe 5 — Proxy conscient de l'identité (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google. **Fortement recommandé** — nécessite `iap_oauth_client_id` / `_secret`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `DNS_SERVER_*` supplémentaires (par exemple `DNS_SERVER_FORWARDERS`, `DNS_SERVER_DOMAIN`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (secrets supplémentaires ; `DNS_SERVER_ADMIN_PASSWORD` est déjà câblé). |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster Services_GCP. |
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `None` | Réplica unique par défaut ; aucune persistance n'est nécessaire. |

### Groupe 7 — StatefulSet (stockage de configuration durable) {#group-7--statefulset-durable-config-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC de bloc par pod à `/etc/dns` au lieu du volume GCS FUSE. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/etc/dns` | Chemin de montage pour le PVC de bloc. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass pour le PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/` | Sonde de démarrage ciblant la page racine publique de la console. |
| `health_check_config` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |

### Groupe 13 / 14 — Système de fichiers et Cloud Storage {#group-13--14--filesystem--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non nécessaire par défaut — le volume GCS à `/etc/dns` persiste déjà l'état. |
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires ; le bucket de configuration à `/etc/dns` est ajouté automatiquement. |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de configuration auto-créé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | TechnitiumDNS n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `technitiumdns` | Inerte — aucune base de données n'est provisionnée. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — TechnitiumDNS n'a pas de dépendance Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `false` | IP éphémère par défaut pour conserver le quota d'IP statiques ; définissez `true` pour une adresse de production stable. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge. |
| `service_url` | URL pour atteindre la console web (pas un point de terminaison DNS). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de configuration). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`,
> `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. La propre
> `validation.tf` de la variante GKE applique ces protections. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée
> avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| S'attendre à ce que ce soit un résolveur DNS | Ne pas pointer les paramètres DNS du client vers ce déploiement | **Critique** | Le port 53/udp+tcp n'est jamais exposé par le modèle de passerelle HTTP(S) de ce module — les requêtes DNS vers ce déploiement échouent simplement ; seule la console web/API est accessible. |
| `enable_iap` | `true` pour tout ce qui dépasse un test rapide | Critique | Sans IAP, la console n'est protégée que par son propre mot de passe administrateur sur l'internet public. |
| Rotation de `DNS_SERVER_ADMIN_PASSWORD` | Changer le mot de passe depuis la console après la première connexion | Élevé | Technitium ne relit jamais la variable d'environnement après le premier démarrage — la rotation de la valeur de Secret Manager seule ne change PAS le mot de passe effectif de la console. |
| `stateful_pvc_mount_path` | `/etc/dns` | Élevé | Monter le PVC ailleurs qu'à `/etc/dns` laisse le chemin de configuration réel non persistant. |
| `enable_cloudsql_volume` | `false` | Élevé | Définir `true` avec `database_type = "NONE"` démarre un sidecar Auth Proxy sans instance à atteindre — rejeté par la protection au moment de la planification. |
| Identifiants `enable_iap` | Définir à la fois `iap_oauth_client_id` et `_secret` ensemble | Élevé | L'activation d'IAP sans les deux valeurs est rejetée au moment de la planification par la protection de validation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `reserve_static_ip` | `true` pour la production | Moyen | Une IP éphémère peut changer lors de la recréation du service, rompant toute URL de console mise en signet/codée en dur. |
| `application_version` | Épingler une version explicite en production | Faible | `latest` suit les versions en amont ; épingler explicitement pour contrôler le calendrier de mise à niveau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et
certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à TechnitiumDNS partagée avec la variante Cloud Run
est décrite dans **[TechnitiumDNS_Common](TechnitiumDNS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : TechnitiumDNS sur GKE Autopilot](../labs/TechnitiumDNS_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [TechnitiumDNS sur Google Cloud Run](TechnitiumDNS_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [TechnitiumDNS Common — Configuration d'application partagée](TechnitiumDNS_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Headscale sur GKE Autopilot](Headscale_GKE.md), [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md), [Gatus sur GKE Autopilot](Gatus_GKE.md) dans la solution **Réseau Zero-trust et DNS**.
