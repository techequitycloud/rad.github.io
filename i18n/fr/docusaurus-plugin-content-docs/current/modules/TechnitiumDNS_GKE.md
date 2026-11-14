---
title: "TechnitiumDNS sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de TechnitiumDNS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/TechnitiumDNS_GKE.md @ 40c83c3f sha256:82326bd22735 -->

# TechnitiumDNS sur GKE Autopilot {#technitiumdns-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/TechnitiumDNS_GKE.png" alt="TechnitiumDNS sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **Divulgation de la portée :** ce module déploie **uniquement la console d'administration web + l'API REST** de Technitium
> (port 5380/HTTP). La fonction de résolveur DNS principale de Technitium (port 53/udp+tcp) **ne peut pas** être exposée
> via le modèle de passerelle HTTP(S) standard de ce module — aucun équilibreur de charge L4 UDP/TCP port-53 brut n'est
> provisionné. Aucun client ne peut interroger ce déploiement en tant que résolveur DNS. Voir les sections §1 et §7 ci-dessous pour
> l'explication complète.

Technitium DNS Server est un serveur DNS autoritaire et récursif auto-hébergé, open-source et multiplateforme
(.NET) avec une console d'administration web complète et une API REST pour gérer les zones, les enregistrements,
le blocage des publicités/traqueurs basé sur DNS, le transfert conditionnel et le DNS-over-HTTPS/TLS. Ce module déploie l'image officielle `technitium/dns-server` sur **GKE Autopilot**, non modifiée, sur la base de
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par TechnitiumDNS et sur la manière de les explorer et de les exploiter depuis la
console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de TechnitiumDNS sur RAD et comparaison {#what-technitiumdns-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de TechnitiumDNS sur RAD coûte environ 24,04 $ US par mois dans un projet Google Cloud que vous possédez, avec les frais de module facturés une fois en crédits RAD.** GKE convient à ce module s'il doit être placé à côté d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](TechnitiumDNS_CloudRun.md) exécute le même déploiement pour environ 16,78 $ US par mois à la place. Si vous n'en avez besoin qu'occasionnellement — pour tester la configuration de zone, une évaluation de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites, puis 2 crédits chacune, et rien pour la suppression ou un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **24,04 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **62 crédits par jour**, soit environ 1 860 par mois (environ 186 $ US au prix de la recharge ; estimé à partir des prix catalogue de Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

**Pourquoi les deux colonnes diffèrent.** Le chiffre géré par RAD inclut les frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre les frais de gestion d'un cluster par compte de facturation, ce que le chiffre du projet propre suppose. Il est estimé à partir des prix catalogue de Google, car il n'y a pas encore suffisamment d'historique GKE géré par RAD pour le mesurer, de sorte que la confirmation de déploiement ne le cite pas. Une deuxième application GKE dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant des frais : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, le réseau est partagé par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de celui-ci.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 GiB | 18,04 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **24,04 $ US** |

### Comparaison {#how-it-compares}

- TechnitiumDNS n'a pas de SaaS commercial hébergé pour cette console d'administration/surface API — il est distribué uniquement en tant que logiciel open-source auto-hébergé, Docker-first, pour qu'un administrateur puisse l'exécuter lui-même.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — tous plus puissants que les 0,5 vCPU / 0,5 GiB de pod dont ce module a besoin ; une micro-instance à vCPU partagé à 5-6 $/mois l'exécuterait confortablement, plus le temps de l'administrateur pour les correctifs et le TLS que Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- Sans base de données ici, la majeure partie du coût d'exécution du projet propre de RAD au-delà du pod lui-même est le coût de gestion du cluster GKE partagé, qui est réparti entre toutes les applications GKE exécutées dans le même projet.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si TechnitiumDNS s'exécute dans un projet géré par RAD pour vous, la suppression de l'ensemble du projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module, cela ne démantèle pas la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), de sorte qu'une restauration ne coûte normalement aucun crédit.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez une configuration de zone personnalisée que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre solution : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours est passée, l'alternative est de supprimer TechnitiumDNS purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) — 40 crédits (4,00 $ US) dans votre propre projet, ou 36 crédits dans un projet géré par RAD.

La suppression permet d'économiser de l'argent seulement si TechnitiumDNS resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet propre ci-dessus (environ 0,80 $ US par jour), cela représente environ 6 jours ou plus, ou environ 1 jour ou plus dans un projet géré par RAD (62 crédits par jour). Il n'y a pas de base de données ici, donc la suppression de cette application libère l'intégralité de son coût d'exécution plutôt qu'une simple part de celui-ci — seuls les frais de cluster partagés, le cas échéant, continuent de fonctionner pour d'autres applications.

Conservez d'abord les données : tout ce que TechnitiumDNS écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui, alors copiez tout ce que vous voulez conserver avant de supprimer.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont restitués au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Aucun SaaS commercial hébergé actuellement vérifié n'existe pour cette surface TechnitiumDNS, donc aucun prix concurrent n'est mentionné.

## 1. Vue d'ensemble {#1-overview}

TechnitiumDNS s'exécute comme une seule charge de travail web pré-construite. Le déploiement connecte un ensemble délibérément petit
de services Google Cloud — TechnitiumDNS n'a pas de dépendance de base de données ou de cache propre :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiement unique, 500m vCPU / 512 MiB par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; les zones/paramètres/journaux sont des fichiers plats locaux, aucune base de données Cloud SQL n'est provisionnée |
| Persistance | Cloud Storage (GCS FUSE, par défaut) ou PVC de bloc (StatefulSet) | Bucket de configuration monté à `/etc/dns` ; passer à un PVC de bloc StatefulSet pour un véritable périphérique de bloc |
| Stockage d'objets | Cloud Storage | Un bucket "config" auto-créé (également la couche de persistance ci-dessus) |
| Cache / file d'attente | **Aucun** | Pas de Redis ; TechnitiumDNS n'a pas besoin de cache externe |
| Secrets | Secret Manager | Un secret auto-généré : `DNS_SERVER_ADMIN_PASSWORD` |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe (console web uniquement) ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — TechnitiumDNS conserve les zones, les paramètres et
  les journaux sous forme de fichiers plats locaux sous `/etc/dns`. Les variables liées à la base de données existent pour être complètes mais
  sont inertes.
- **Persistant par défaut via GCS FUSE.** `workload_type = "Deployment"` avec un volume monté GCS à
  `/etc/dns` — la configuration survit aux redémarrages de pod. Passez à un **PVC de bloc StatefulSet**
  (`stateful_pvc_enabled = true` avec `stateful_pvc_mount_path = "/etc/dns"`) pour un véritable périphérique de bloc
  avec des garanties de verrouillage d'écriture plus fortes ; le module désactive automatiquement le volume GCS dans ce cas.
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`) — une console d'administration à faible trafic
  n'a pas besoin d'une mise à l'échelle horizontale.
- **Exposé via un service LoadBalancer** (`service_type = "LoadBalancer"`) avec une IP **éphémère**
  (`reserve_static_ip = false`) par défaut, conservant le quota d'IP statiques souvent rare du projet — la
  console n'intègre pas d'URL auto-référente dans sa configuration de démarrage.
- **Le point de terminaison de santé est `/`**, la page racine non authentifiée de la console, qui renvoie HTTP 200 avec
  le HTML complet de la console dès que le serveur lie son port.
- **La variante GKE s'exécute sur son propre espace de noms de locataire.** Donnez à `TechnitiumDNS_GKE` un
  `tenant_id` distinct (par exemple `"gke"`) si déployé à côté de `TechnitiumDNS_CloudRun` sur le même
  locataire, pour éviter une collision de noms.
- **Un secret auto-généré.** `DNS_SERVER_ADMIN_PASSWORD` amorce le compte `admin` initial uniquement lors du
  tout premier démarrage ; les redémarrages ultérieurs l'ignorent.
- **Pas de résolveur DNS.** Voir la section §7 ci-dessous — c'est la chose la plus importante à comprendre avant
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
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Persistance — le bucket de configuration Cloud Storage (ou PVC de bloc) {#b-persistence--the-config-cloud-storage-bucket-or-block-pvc}

TechnitiumDNS n'a **pas d'instance Cloud SQL**. Toutes les zones, les paramètres, la base de données d'authentification et les journaux se trouvent sous
`/etc/dns`. Par défaut, cela est sauvegardé par un bucket Cloud Storage monté GCS FUSE ; passez à un PVC de bloc StatefulSet
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

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load Balancing via un service LoadBalancer — il s'agit de la **console web**, et non d'un point de terminaison DNS. Un domaine personnalisé avec un certificat géré par Google peut être activé pour la console ; une adresse IP statique n'est PAS réservée par défaut (définissez `reserve_static_ip = true` pour une adresse stable lors des redéploiements).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

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
- **Amorçage de l'administrateur au premier démarrage.** `DNS_SERVER_ADMIN_PASSWORD` n'est appliqué que lorsque
  `/etc/dns/auth.config` n'existe pas encore. Lors de chaque redémarrage ou redéploiement ultérieur, le
  `auth.config` persistant l'emporte.
- **`imagePullPolicy = Always` n'est PAS forcé pour ce module** — l'image est tirée fraîche (pré-construite,
  résolue par digest) plutôt qu'une balise construite/miroir personnalisée, donc la préoccupation de cache périmé d'App_GKE pour les images reconstruites
  ne s'applique pas ici de la même manière ; une nouvelle version nécessite toujours un nouveau `application_version`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui renvoie HTTP 200 avec le HTML complet de la console
  dès que le serveur lie le port 5380. Vérifiez depuis l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
    http://<service-name>.$NAMESPACE.svc.cluster.local/
  ```
- **Connectez-vous.** Accédez à l'IP/nom d'hôte externe dans un navigateur, connectez-vous en tant que `admin` avec le mot de passe Secret-Manager,
  et changez-le immédiatement depuis la page de gestion des utilisateurs de la console (Technitium ne relit pas
  `DNS_SERVER_ADMIN_PASSWORD` après le premier démarrage).
- **API REST.** Toutes les actions de la console sont également disponibles via l'API REST en utilisant un jeton de session obtenu
  via `/api/user/login`. Voir
  [la documentation de l'API de Technitium](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md).
- **Pas de résolution DNS depuis ce déploiement.** Voir la section §7 ci-dessous.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou
notables pour TechnitiumDNS sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son
comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; utilisez une valeur distincte (par exemple `"gke"`) à côté de la variante CloudRun sur le même locataire. |
| `application_name` | `technitiumdns` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise de version de l'image TechnitiumDNS (par exemple `latest`, `13.5.1`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle telle quelle ; `custom` accepté pour une compatibilité ascendante. |
| `min_instance_count` | `1` | Réplicas minimum (GKE n'a pas de mise à l'échelle à zéro pour les déploiements). |
| `max_instance_count` | `1` | Réplicas maximum. |
| `container_resources` | `{ cpu_limit="500m", memory_limit="512Mi" }` | CPU/mémoire par pod. |
| `container_port` | `5380` | Port par défaut de la console web. |
| `workload_type` | `Deployment` | Sans état par défaut ; `StatefulSet` pour un PVC de bloc durable par pod. |
| `enable_cloudsql_volume` | `false` | Désactivé — TechnitiumDNS n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image TechnitiumDNS dans Artifact Registry. |

### Groupe 5 — Proxy sensible à l'identité (IAP) {#group-5--identity-aware-proxy-iap}

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
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/` | Sonde de démarrage ciblant la page racine publique de la console. |
| `health_check_config` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |

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
| `enable_custom_domain` | `true` | Provisionne l'Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `false` | IP éphémère par défaut pour conserver le quota d'IP statiques ; définissez `true` pour une adresse de production stable. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`,
> `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. La propre
> `validation.tf` de la variante GKE applique ces protections. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| S'attendre à ce que ce soit un résolveur DNS | Ne pas pointer les paramètres DNS du client vers ce déploiement | **Critique** | Le port 53/udp+tcp n'est jamais exposé par le modèle de passerelle HTTP(S) de ce module — les requêtes DNS contre ce déploiement échouent simplement ; seule la console web/API est accessible. |
| `enable_iap` | `true` pour tout ce qui dépasse un test rapide | Critique | Sans IAP, la console n'est protégée que par son propre mot de passe administrateur sur l'internet public. |
| Rotation de `DNS_SERVER_ADMIN_PASSWORD` | Changez le mot de passe depuis la console après la première connexion | Élevé | Technitium ne relit jamais la variable d'environnement après le premier démarrage — la rotation de la valeur Secret Manager seule ne change PAS le mot de passe effectif de la console. |
| `stateful_pvc_mount_path` | `/etc/dns` | Élevé | Monter le PVC ailleurs qu'à `/etc/dns` laisse le chemin de configuration réel non persistant. |
| `enable_cloudsql_volume` | `false` | Élevé | Définir `true` avec `database_type = "NONE"` démarre un sidecar Auth Proxy sans instance à atteindre — rejeté par la protection au moment de la planification. |
| Identifiants `enable_iap` | Définissez à la fois `iap_oauth_client_id` et `_secret` ensemble | Élevé | L'activation d'IAP sans les deux valeurs est rejetée au moment de la planification par la protection de validation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `reserve_static_ip` | `true` pour la production | Moyen | Une IP éphémère peut changer lors de la recréation du service, rompant toute URL de console mise en signet/codée en dur. |
| `application_version` | Épinglez une version explicite en production | Faible | `latest` suit les versions en amont ; épinglez explicitement pour contrôler le calendrier des mises à niveau. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity, autoscaling, ingress et
certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à TechnitiumDNS partagée avec la variante Cloud Run
est décrite dans **[TechnitiumDNS_Common](TechnitiumDNS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : TechnitiumDNS sur GKE Autopilot](../labs/TechnitiumDNS_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [TechnitiumDNS sur Google Cloud Run](TechnitiumDNS_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [TechnitiumDNS Common — Configuration d'application partagée](TechnitiumDNS_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Headscale sur GKE Autopilot](Headscale_GKE.md), [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md), [Gatus sur GKE Autopilot](Gatus_GKE.md) dans la solution **Réseau Zero-trust et DNS**.
