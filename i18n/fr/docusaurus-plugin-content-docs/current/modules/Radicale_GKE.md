---
title: "Radicale sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Radicale sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Radicale_GKE.md @ e69407af sha256:3bc9ab399b31 -->

# Radicale sur GKE Autopilot {#radicale-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Radicale_GKE.png" alt="Radicale sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Radicale est un **serveur CalDAV/CardDAV** open-source et auto-hébergé pour la
synchronisation des calendriers et des contacts — une application WSGI
légère, entièrement en Python, sans framework ni base de données. Il stocke
chaque calendrier et carnet d'adresses sous forme de fichiers iCalendar/vCard
bruts sur disque. Ce module déploie Radicale sur **GKE Autopilot** en s'appuyant
sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Radicale et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Radicale sur RAD, et comment cela se compare {#what-radicale-costs-on-rad-and-how-that-compares}

**L'exécution de Radicale dans votre propre projet Google Cloud coûte environ 42,08 $ US/mois en infrastructure, plus des frais de module uniques de 75 crédits RAD** (dimensionnés à 1 vCPU / 1 GiB sur les pods GKE Autopilot). RAD facture les frais de module une seule fois, au moment du déploiement — jamais plus lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la marge de RAD — environ 67 crédits/jour — et les frais de module sont 10 % inférieurs, à 67,50 crédits. Voir "Mettre en pause gratuitement" ci-dessous pour savoir comment un déploiement Radicale géré par RAD peut être arrêté, sans frais de fonctionnement, jusqu'à ce que vous en ayez à nouveau besoin. (ou voir le [guide Cloud Run](Radicale_CloudRun.md) pour l'option à moindre coût)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits (une fois) | 67,50 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût de fonctionnement Google Cloud | ~42,08 $ US/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~67 crédits/jour, mesurés à l'heure au prix catalogue + marge de RAD |

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **42,08 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les applications GKE exécutées dans le même projet, il est donc de 0 $ si c'est votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement comparable, pour ce projet open-source exact, donc la comparaison honnête est un serveur auto-géré nu : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un DigitalOcean 2 vCPU/4 Go Droplet (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte de cette application (1 vCPU ou moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes, donc une machine auto-gérée nue dimensionnée pour correspondre coûterait moins cher que les chiffres ci-dessus — mais vous seriez toujours responsable de chaque patch, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour un montant similaire ou identique est une base de données gérée, des identifiants conservés dans Secret Manager, la surveillance et une mise à jour en un clic, dont aucun n'est gratuit sur un VPS nu.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du système d'exploitation/de la base de données, effectuez et testez les sauvegardes, et renouvelez les certificats ; les services Cloud SQL, Secret Manager et de surveillance gérés par RAD s'occupent des trois pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option phare sur un projet **géré par RAD**, et elle est gratuite lorsqu'elle est en pause. La suppression
d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet lui-même —
la propre suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne démantèle pas
la base de données, une VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement,
et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet — demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les
mêmes ressources déjà présentes : c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais
les frais de module à nouveau. L'ensemble de la restauration ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build
pour une chaîne de déploiements typique. Ce qu'il faut : vous devez être propriétaire du projet (pas seulement faire
gérer sa facturation par RAD), vous devez le restaurer vous-même dans les 30 jours — après cela, Google
le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des études et
démos utilisent). Google indique que la plupart des services sont à nouveau entièrement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, de sorte que le bucket de sauvegarde est très probablement
supprimé dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **projet personnel** (ou un projet géré par RAD au-delà de sa fenêtre de restauration de 30 jours),
est de supprimer Radicale purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module
plus les builds — environ **78-81 crédits** au total pour ce module.

La suppression ne permet d'économiser de l'argent que si Radicale restait inutilisé assez longtemps pour compenser
ce coût de redéploiement par rapport à son propre coût de fonctionnement — pour ce module, cela représente environ 6 jours ou plus d'inactivité,
sur la base de son coût de fonctionnement de 42,08 $ US/mois mentionné ci-dessus. La majeure partie de ce coût de fonctionnement est
généralement la base de données et toute VM de fichier/cache partagée, et elles ne s'arrêtent que lorsque rien d'autre dans le
projet ne les utilise, donc la suppression de cette application seule n'économise que sa propre part de calcul si quelque chose d'autre
partage le projet.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec
celui-ci, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant obtient
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
  partenaire remet le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Resource Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Radicale s'exécute comme un seul pod Python WSGI. Le déploiement relie un
petit ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de processus Python unique, 1 vCPU / 1 GiB par défaut |
| Base de données | aucune | Radicale stocke chaque collection sous forme de fichiers bruts — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | Cloud Storage, ou un PVC de bloc | PVC de bloc par défaut (`stateful_pvc_enabled = true`) ; un bucket GCS `storage` est également provisionné et est le point de montage uniquement si le PVC est désactivé |
| Cache et file d'attente | aucun | Radicale n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Un véritable `ADMIN_PASSWORD` généré — Radicale n'est livré avec aucun compte administrateur par défaut |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données d'aucune sorte.** `Radicale_Common` corrige `database_type =
  "NONE"` — Radicale est un pur stockage de système de fichiers.
- **Build personnalisé, avec un wrapper léger.** `Radicale_Common` superpose un point d'entrée cloud
  sur l'image officielle `ghcr.io/kozea/radicale` via Cloud Build, puis
  met en miroir le résultat dans Artifact Registry.
- **PVC de stockage par blocs par défaut, et obligatoire.** `stateful_pvc_enabled = true`
  (résout automatiquement `workload_type` en `StatefulSet`) donne aux collections de Radicale
  un véritable verrouillage de fichiers POSIX et des renommages de répertoires. Sur GCS FUSE, la création
  d'un calendrier ou d'un carnet d'adresses échoue, car gcsfuse ne peut pas renommer le répertoire temporaire
  dans lequel Radicale construit chaque collection. `stateful_pvc_storage_class` est par défaut `standard` (HDD) plutôt
  que SSD — les collections sont de petits fichiers texte sans besoin d'IOPS élevés.
- **Pas de compte administrateur par défaut — un secret réel généré.** `Radicale_Common`
  génère et injecte un véritable `ADMIN_PASSWORD` à chaque déploiement (voir le
  [guide commun](Radicale_Common.md)).
- **`max_instance_count` épinglé à `1`, `min_instance_count` par défaut à
  `0`.** Le backend de stockage de Radicale n'est pas conçu pour un accès
  multi-instances concurrent, mais n'a pas de base de données/index à réchauffer au démarrage, donc
  la mise à l'échelle à zéro est sûre et rapide.
- **MKCOL fonctionne nativement ici — mais le job d'amorçage peut ne pas atteindre un PVC.** Le service LoadBalancer L4 simple de GKE n'a pas de restriction MKCOL (contrairement à Cloud Run),
  mais avec `stateful_pvc_enabled = true` (par défaut), les collections pré-créées par le job d'amorçage
  peuvent ne pas apparaître — voir §3.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Radicale {#a-gke-autopilot--the-radicale-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100    # Deployment mode
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100  # StatefulSet mode
  ```

### B. Stockage — Cloud Storage ou un PVC de bloc {#b-storage--cloud-storage-or-a-block-pvc}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
  kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
  ```

### C. Secret Manager {#c-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~radicale"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Radicale {#3-radicale-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init` — Radicale
  n'a pas de base de données à amorcer.
- **`seed-default-collections` s'exécute au moment du déploiement.** Un job d'initialisation ponctuel
  (`execute_on_apply = true`) écrit un "Calendrier par défaut"
  et un "Carnet d'adresses par défaut" directement sur le volume de stockage pour l'utilisateur
  administrateur.
- **Pas de compte administrateur par défaut.** L'authentification de Radicale est par défaut `denyall` jusqu'à ce qu'un fichier htpasswd existe. `Radicale_Common` génère un véritable
  `ADMIN_PASSWORD` et le point d'entrée cloud écrit à la fois la configuration INI et une
  entrée htpasswd bcrypt **à chaque démarrage de pod**.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

### ⚠ MKCOL fonctionne sur GKE — mais vérifiez où les écritures de votre job d'amorçage atterrissent {#-mkcol-works-on-gke--but-check-where-your-seed-jobs-writes-land}

Contrairement à Cloud Run, le service LoadBalancer L4 simple de GKE **ne restreint pas**
la méthode WebDAV `MKCOL` — confirmé en direct (`201 Created`). Un vrai
client CalDAV/CardDAV peut créer de nouvelles collections directement sans
avoir besoin de contournement, ce qui est l'une des raisons pour lesquelles `Radicale_GKE` est mieux adapté
pour une utilisation plus intensive ou en production.

Cependant, le job d'initialisation par défaut `seed-default-collections` est un job commun
Cloud-Run/GKE et ne monte que le bucket GCS partagé `storage`
— il **ne peut pas** s'attacher à un PVC de bloc d'un StatefulSet (un job Kubernetes
ne peut pas monter un PVC `ReadWriteOnce` déjà détenu par un pod en cours d'exécution). Donc :

- **Avec `stateful_pvc_enabled = true`** (par défaut) : les écritures du job d'amorçage atterrissent dans le bucket GCS autrement inutilisé,
  et le "Calendrier par défaut"/"Carnet d'adresses par défaut" **n'apparaîtra pas** sur
  le système de fichiers du pod en cours d'exécution, soutenu par le PVC. Cela est inoffensif — créez votre
  premier calendrier via un vrai client CalDAV, ou `curl -X MKCOL` (confirmé
  fonctionnel), au lieu d'attendre les valeurs par défaut pré-amorçées.
- **Sans PVC** (mode de déploiement basé sur GCS) : les écritures du job d'amorçage atterrissent dans
  le même bucket que le pod en cours d'exécution, donc les valeurs par défaut apparaissent — mais
  la création de toute autre collection échoue sur GCS FUSE.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Radicale sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `radicale` | Nom de base des ressources. |
| `application_display_name` | `Radicale` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Se résout en la build épinglée `RADICALE_VERSION=3.7.7` — les tags GHCR n'ont pas de préfixe `v`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5232` | Fixé via `Radicale_Common` ; cette variable n'est pas transmise à `App_GKE`. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Limites de mise à l'échelle HPA ; `max` est épinglé à `1` de manière non négociable. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Conserver `true`** — donne aux collections de Radicale un véritable verrouillage de fichiers POSIX et des renommages de répertoires ; sur GCS FUSE, la création d'une collection échoue. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_mount_path` | `/var/lib/radicale` | Doit correspondre à la déclaration `VOLUME` de l'image de base. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, pas SSD — les collections sont de petits fichiers texte sans besoin d'IOPS élevés ; évite le quota strict `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `3000` | Rend le PVC inscriptible par le groupe ; Radicale s'exécute en tant que UID 1000 / GID 2000. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Monté à `/var/lib/radicale` via GCS FUSE **sauf si** `stateful_pvc_enabled = true`, auquel cas le PVC prend le même chemin de montage. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Radicale_Common` — Radicale n'a pas de base de données d'aucune sorte. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `seed-default-collections` (injecté par `Radicale_Common`) | Voir §3 pour la mise en garde GKE+PVC. Fournir une liste personnalisée remplace entièrement cette valeur par défaut. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Redirection 302 non authentifiée de Radicale vers son interface web ; les deux types de sondes considèrent 2xx–3xx comme sains. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `storage_buckets` | Le bucket `storage` (inutilisé comme point de montage lorsque `stateful_pvc_enabled = true`). |
| `statefulset_name` | Nom du StatefulSet, lorsque `workload_type = "StatefulSet"`. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (par défaut) | Élevé | Sans cela, `/var/lib/radicale` est basé sur GCS FUSE, et la création d'un calendrier ou d'un carnet d'adresses échoue (gcsfuse ne peut pas renommer les répertoires). |
| Attendre des collections par défaut sur un déploiement basé sur PVC | Créer le premier calendrier via un vrai client CalDAV ou `curl -X MKCOL` | Moyen | Le job `seed-default-collections` ne peut pas monter un PVC `ReadWriteOnce` d'un StatefulSet, donc ses écritures atterrissent dans le bucket GCS inutilisé à la place — les valeurs par défaut pré-amorçées n'apparaissent pas silencieusement sur le système de fichiers du pod en cours d'exécution. |
| `max_instance_count` | Laisser à `1` | **Critique** | Le backend de stockage de Radicale n'est pas conçu pour un accès multi-instances concurrent ; augmenter cela risque une corruption des données. |
| `stateful_pvc_storage_class` | Laisser à `standard` (HDD) | Faible–Moyen | Passer à `standard-rwo`/`premium-rwo` (SSD) puise dans le quota `SSD_TOTAL_GB` beaucoup plus strict sans réel avantage — le modèle d'E/S de Radicale n'a pas besoin des IOPS du SSD. |
| Identifiant administrateur | Récupérer depuis Secret Manager après le premier déploiement | **Critique** | Contrairement aux applications avec un identifiant par défaut bien connu, Radicale génère un vrai secret — il n'y a aucun moyen de se connecter tant que vous n'avez pas récupéré `ADMIN_PASSWORD`. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Radicale partagée avec la variante Cloud Run est décrite dans
**[Radicale_Common](Radicale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Radicale sur GKE Autopilot](../labs/Radicale_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Radicale sur Google Cloud Run](Radicale_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Radicale Common — Configuration d'application partagée](Radicale_Common.md) — la configuration partagée par les deux cibles de déploiement.
