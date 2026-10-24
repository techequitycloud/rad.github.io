---
title: "PocketBase sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de PocketBase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PocketBase_GKE.md @ 1665a43e sha256:910e4c7bbc2e -->

# PocketBase sur GKE Autopilot {#pocketbase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PocketBase_GKE.png" alt="PocketBase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PocketBase est un backend open-source en un seul fichier — une base de données SQLite
embarquée avec une API REST en temps réel, une authentification intégrée, un stockage de
fichiers et un tableau de bord d'administration. Ce module déploie PocketBase sur **GKE
Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par PocketBase et sur la manière de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## Ce que coûte PocketBase sur RAD, et comment cela se compare {#what-pocketbase-costs-on-rad-and-how-that-compares}

**L'exécution de PocketBase dans votre propre projet Google Cloud coûte environ 42,08 $ US/mois en infrastructure, plus des frais de module uniques de 75 crédits RAD** (dimensionnés à 1 vCPU / 1 GiB sur les pods GKE Autopilot). RAD facture les frais de module une seule fois, au moment du déploiement — jamais plus lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la marge de RAD — environ 67 crédits/jour — et les frais de module sont 10 % inférieurs, à 67,50 crédits. Voir "Mettre en pause gratuitement" ci-dessous pour savoir comment un déploiement PocketBase géré par RAD peut être arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin. (ou voir le [guide Cloud Run](PocketBase_CloudRun.md) pour l'option moins chère)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits (une fois) | 67,50 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~42,08 $ US/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~67 crédits/jour, mesurés à l'heure au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (add-ons, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **42,08 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les applications GKE exécutées dans le même projet, donc il est de 0 $ si c'est votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement comparable, pour ce projet open-source exact, donc la comparaison honnête est un serveur autogéré nu : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un Droplet DigitalOcean 2 vCPU/4 Go (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte propre de cette application (1 vCPU ou moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes, donc une machine autogérée nue dimensionnée pour correspondre coûterait moins cher que les chiffres ci-dessus — mais vous seriez toujours responsable de chaque correctif, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour un montant en dollars identique ou similaire, c'est une base de données gérée, des identifiants conservés dans Secret Manager, une surveillance et une mise à jour en un clic, ce qu'un VPS nu ne vous offre pas gratuitement.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité OS/base de données, effectuez et testez les sauvegardes, et renouvelez les certificats ; les services gérés de RAD (Cloud SQL, Secret Manager et surveillance) s'occupent des trois pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite pendant la
pause. La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à
Google de supprimer le projet lui-même — la suppression logicielle récupérable de 30 jours
de Google. Contrairement à la suppression d'un seul module, cela ne détruit pas la base de
données, une VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet — demande à
Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu.
Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources
déjà présentes : c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. L'ensemble de la restauration ne coûte qu'une
poignée de crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements
typique. Ce qu'il faut : vous devez être propriétaire du projet (pas seulement faire gérer
sa facturation par RAD), vous devez le restaurer vous-même dans les 30 jours — après cela,
Google le supprime définitivement — et la restauration est admise comme la création d'un
nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du
palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations
d'étude et de démonstration). Google indique que la plupart des services sont à nouveau
pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, de sorte que le bucket de sauvegarde est très probablement
supprimé dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver
ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet)
avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a
pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **propre projet** (ou un projet géré par RAD au-delà de sa fenêtre
de restauration de 30 jours), consiste à supprimer PocketBase purement et simplement et à le
redéployer plus tard. Un redéploiement coûte à nouveau les frais de module plus les builds
— environ **78-81 crédits** au total pour ce module.

La suppression ne permet d'économiser de l'argent que si PocketBase reste inutilisé
suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre
coût d'exécution — pour ce module, cela représente environ 6 jours ou plus d'inactivité,
basé sur son propre coût d'exécution de 42,08 $ US/mois ci-dessus. La majeure partie de ce
coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée,
et elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
suppression de cette application seule n'économise que sa propre part de calcul si quelque
chose d'autre partage le projet.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde
avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe.
  Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle
  directement avec le client. Si le portefeuille est faible, la facturation est suspendue et
  les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la
  fin, le partenaire transfère le projet et les déploiements deviennent la propriété du
  client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
  KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ;
[radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et
les estimations de crédits quotidiens ;
[Resource Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

PocketBase s'exécute comme un seul binaire Go autonome. Sur GKE, il est planifié comme un
**StatefulSet** avec un volume persistant de type bloc afin que sa base de données SQLite
embarquée bénéficie d'un verrouillage de fichier POSIX fiable. Le déploiement connecte un
ensemble délibérément minimal de services :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique en tant que pod **StatefulSet**, 1 vCPU / 1 GiB par défaut, port **8090** |
| Base de données | **SQLite embarquée** | Pas de Cloud SQL — la base de données réside sur un PVC de type bloc à `/pb_data` |
| Stockage persistant | Disque persistant (PVC de type bloc) | Un PVC ReadWriteOnce par pod (20 GiB par défaut) monté à `/pb_data` |
| Cache et file d'attente | **Aucun** | PocketBase n'utilise pas Redis ; `enable_redis = false` |
| Secrets | Secret Manager | Aucun auto-généré — l'authentification réside dans SQLite ; secrets facultatifs pour votre propre usage |
| Ingress | Cloud Load Balancing | `LoadBalancer` par défaut (externe) ; PocketBase est un backend-as-a-service public, pas une charge de travail interne uniquement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **La base de données est SQLite embarquée — il n'y a pas de Cloud SQL.** PocketBase
  stocke chaque enregistrement, jeton d'authentification et fichier téléchargé sous
  `/pb_data`, qui est un **PVC de type bloc** sur GKE.
- **StatefulSet + PVC de type bloc par défaut.** `stateful_pvc_enabled = true` — sans
  `workload_type` explicite, cela se résout automatiquement en `StatefulSet`. Le
  stockage de type bloc offre à SQLite le verrouillage de fichier fiable dont il a besoin
  (SQLite sur GCS FUSE n'est pas fiable pour le verrouillage, c'est pourquoi GKE utilise un
  PVC tandis que Cloud Run utilise FUSE).
- **Le PVC se monte à `/pb_data`** (20 GiB par défaut). La couche Common
  définit `enable_gcs_storage_volume = false` lorsque le PVC est activé, il n'y a donc pas de
  double montage au même chemin.
- **Réplica unique.** SQLite est mono-écriture et le PVC est ReadWriteOnce, donc
  `min_instance_count` et `max_instance_count` sont tous deux par défaut à `1`. Ne
  pas augmenter `max_instance_count`.
- **`service_type = LoadBalancer` par défaut** (accès externe). PocketBase est un
  backend-as-a-service public avec un tableau de bord d'administration et une API REST, il
  est donc accessible depuis l'extérieur du cluster dès la sortie de la boîte ; définissez
  `service_type = "ClusterIP"` si vous le souhaitez uniquement interne, ou ajoutez un domaine
  personnalisé + un certificat géré.
- **Le compte administrateur est créé de manière interactive lors de la première exécution à
  `/_/`.** Aucun mot de passe administrateur n'est injecté. Créez le
  super-utilisateur immédiatement après que l'application soit accessible.
- **Aucun secret n'est auto-généré.** PocketBase émet et stocke toute l'authentification
  lui-même ; Secret Manager n'est utilisé que si vous ajoutez vos propres secrets.
- **Pas de Redis, pas de NFS.** Tout l'état est le seul PVC `/pb_data`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail PocketBase {#a-gke-autopilot--the-pocketbase-workload}

PocketBase s'exécute en tant que pod **StatefulSet** sur Autopilot, qui facture le CPU/la
mémoire demandés par le pod. Le StatefulSet donne au pod une identité stable et le lie à
son PVC `/pb_data` lors des redémarrages.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez le StatefulSet
  PocketBase pour voir le pod, les révisions et les événements. Kubernetes Engine → Services
  et Ingress montre comment il est exposé.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (Déploiement vs StatefulSet).

### B. Base de données — SQLite embarquée (pas de Cloud SQL) {#b-database--embedded-sqlite-no-cloud-sql}

Il n'y a **pas d'instance Cloud SQL**. La base de données de PocketBase est un ensemble de
fichiers SQLite sur le PVC de type bloc à `/pb_data`. Pour inspecter ou sauvegarder la
base de données, vous travaillez avec le contenu du PVC, pas un point de terminaison SQL.

- **Console :** Kubernetes Engine → Stockage → Revendications de volume persistant → le PVC
  PocketBase.
- **CLI :**
  ```bash
  # List the PVC bound to the PocketBase pod:
  kubectl get pvc -n "$NAMESPACE"
  # Inspect / copy the SQLite database out of the running pod for backup:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /pb_data
  kubectl cp "$NAMESPACE"/<pod-name>:/pb_data/data.db ./pb_data-backup.db
  ```

### C. Cloud Storage / Stockage persistant — le volume `/pb_data` {#c-cloud-storage--persistent-storage--the-pb_data-volume}

Sur GKE, le répertoire `/pb_data` — la base de données SQLite, les fichiers
téléchargés et les paramètres — est un **PVC de type bloc** (ReadWriteOnce, 20 GiB par
défaut), et non un bucket GCS. Un bucket de données Cloud Storage est toujours déclaré par
la couche Common, mais sur GKE, le PVC est l'autorité et le montage FUSE est désactivé pour
éviter un double montage.

- **Console :** Kubernetes Engine → Stockage ; Compute Engine → Disques (le PD de
  sauvegarde).
- **CLI :**
  ```bash
  kubectl get pvc,pv -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>          # size, StorageClass, bound PV
  ```

Voir [App_GKE](App_GKE.md) pour les modèles de PVC StatefulSet, les StorageClasses et les
options CMEK.

### D. Secret Manager {#d-secret-manager}

**Aucun secret n'est auto-généré** pour PocketBase — son authentification est stockée dans
SQLite. Secret Manager n'est utilisé que si vous injectez vos propres secrets (par exemple,
les identifiants SMTP ou les clés de sauvegarde externes) via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~pocketbase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via un service `LoadBalancer` (externe),
reflétant le rôle de PocketBase en tant que backend-as-a-service public. Pour le rendre
interne uniquement, définissez `service_type = ClusterIP` ; un domaine personnalisé avec un
certificat géré par Google est également disponible, et une IP statique peut être réservée
afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP
statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers Cloud
Monitoring. Des tests de disponibilité et des stratégies d'alerte facultatifs sont
disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application PocketBase {#3-pocketbase-application-behaviour}

- **Pas de job de base de données au premier déploiement.** PocketBase crée sa propre base
  de données SQLite, ses collections système et son schéma au premier démarrage sous
  `/pb_data`. Il n'y a pas de job `db-init` à exécuter ou à surveiller.
- **Les migrations s'appliquent automatiquement au démarrage.** PocketBase exécute lui-même
  toutes les migrations de schéma en attente à chaque démarrage, de sorte que la mise à
  niveau `application_version` applique les modifications de schéma sans étape de migration
  distincte. Sauvegardez toujours le PVC avant une mise à jour de version.
- **Le super-utilisateur administrateur est créé lors de la première exécution.** Une fois
  PocketBase accessible, ouvrez `/_/` et créez le compte administrateur. Tant
  qu'il n'existe pas, toute personne qui atteint `/_/` peut le revendiquer et
  posséder l'instance — considérez cela comme une étape de première exécution sensible au
  temps.
- **Le PVC `/pb_data` est le seul état durable.** La base de données SQLite, les
  fichiers téléchargés et les paramètres résident tous sur le PVC de type bloc. Il survit
  aux redémarrages et à la replanification des pods ; protégez-le et sauvegardez-le selon
  un calendrier.
- **StatefulSet à réplica unique.** SQLite sérialise les écritures via un seul fichier et
  le PVC est ReadWriteOnce. `min_instance_count` et `max_instance_count` sont tous deux par
  défaut à `1` ; ne pas augmenter `max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`, le
  point de terminaison public non authentifié de PocketBase (renvoie HTTP `200` /
  `{"code":200,"message":"API is healthy."}`). Le premier démarrage est rapide car il n'y a pas de base de données
  externe à attendre.
- **Vérifier l'état d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- \
    wget -qO- http://127.0.0.1:8090/api/health
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | sort
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour PocketBase sont listés ;
toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement et ses
valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `pocketbase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image ; `latest` se résout en ARG de build `0.22.21` épinglé. Épinglez une version explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; 1 vCPU est confortable pour le binaire Go unique. |
| `memory_limit` | `1Gi` | Mémoire par pod ; PocketBase est léger. |
| `min_instance_count` | `1` | Maintenir à 1 — GKE exige min ≥ 1 et SQLite est mono-écriture. |
| `max_instance_count` | `1` | **Ne pas augmenter.** SQLite + PVC ReadWriteOnce sont mono-écriture ; >1 corrompt les données. |
| `container_port` | `8090` | PocketBase écoute sur le port 8090 (API HTTP + interface d'administration). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL Auth Proxy — PocketBase n'utilise pas de base de données externe. |
| `enable_image_mirroring` | `true` | Mettre en miroir/construire l'image PocketBase dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Externe par défaut (PocketBase est public) ; utiliser `ClusterIP` pour un accès interne uniquement. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en StatefulSet car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Réplica unique, donc la persistance n'est pas nécessaire. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Fortement recommandé** — donne à la base de données SQLite un stockage de bloc durable avec un verrouillage fiable. |
| `stateful_pvc_size` | `20Gi` | Dimensionner le PVC pour la base de données SQLite plus les fichiers téléchargés et les frais généraux. |
| `stateful_pvc_mount_path` | `/pb_data` | Doit être le répertoire de données de PocketBase — ne pas modifier. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai de 15s | Sonde de démarrage ; rapide car il n'y a pas de base de données externe à attendre. |
| `liveness_probe` | HTTP `/api/health`, délai de 30s | Sonde de vivacité contre le point de terminaison de santé public. |
| `uptime_check_config` | désactivé, chemin `/api/health` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — PocketBase persiste tout dans le PVC `/pb_data`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` / `db_user` | _(vide)_ | Inerte — PocketBase utilise une base de données SQLite embarquée ; aucun rôle/base de données Cloud SQL n'est créé. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'Ingress pour les noms d'hôtes personnalisés + certificat géré (sert uniquement lorsque `application_domains` est défini). |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre PocketBase. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet PocketBase. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt (faux lors du premier apply d'un nouveau cluster inline). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les
> combinaisons* au moment de la planification — un type de charge de travail
> `Deployment` avec `stateful_pvc_enabled = true`, des valeurs de mémoire ResourceQuota
> en entier nu, IAP sans identités autorisées, des valeurs de sonde ou de rétention hors
> plage. Une configuration invalide échoue à la **planification** avec une erreur claire et
> nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critique | SQLite est mono-écriture et le PVC est ReadWriteOnce ; un deuxième réplica ne peut pas monter le volume et les écritures concurrentes corrompent la base de données. |
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC de type bloc, SQLite revient à un stockage de type GCS FUSE avec un verrouillage peu fiable → corruption de la base de données. |
| Le PVC `/pb_data` | Ne jamais supprimer ; sauvegarder | Critique | Le PVC **est** la base de données et le stockage de fichiers — le supprimer détruit toutes les données. |
| `stateful_pvc_mount_path` | `/pb_data` (fixe) | Critique | Monter le PVC ailleurs laisse PocketBase écrire sa base de données dans un stockage de pod éphémère, perdu au redémarrage. |
| Compte administrateur à `/_/` | Créer immédiatement après l'accès | Critique | Tant que le super-utilisateur n'existe pas, toute personne atteignant `/_/` peut le revendiquer et posséder l'instance. |
| Mise à jour `application_version` | Sauvegarder le PVC en premier | Élevé | PocketBase migre automatiquement le schéma au démarrage ; une mise à niveau interrompue peut laisser la base de données SQLite en cours de migration. |
| `workload_type` | laisser `null` (auto StatefulSet) | Élevé | Forcer `Deployment` avec `stateful_pvc_enabled = true` échoue à la validation au moment de la planification. |
| `service_type` | `LoadBalancer` (externe, par défaut) ou `ClusterIP` (interne) | Élevé | Passer à `ClusterIP` lorsque l'accès externe est nécessaire rend l'application inaccessible depuis l'extérieur du cluster. |
| `enable_iap` | Uniquement pour les déploiements privés | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les clients API publics et l'interface d'administration. |
| `stateful_pvc_size` | `20Gi` (augmenter pour les téléchargements de fichiers lourds) | Moyen | Un PVC trop petit se remplit à mesure que les fichiers téléchargés s'accumulent, et les PVC ne peuvent pas toujours être réduits. |
| `memory_limit` | `1Gi` | Faible | PocketBase est léger ; le surprovisionnement n'ajoute que des coûts sur Autopilot. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à PocketBase partagée avec la variante Cloud Run est décrite dans
**[PocketBase_Common](PocketBase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PocketBase sur GKE Autopilot](../labs/PocketBase_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [PocketBase sur Google Cloud Run](PocketBase_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [PocketBase Common — Configuration d'application partagée](PocketBase_Common.md) — la configuration partagée par les deux cibles de déploiement.
