---
title: "Prowlarr sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Prowlarr sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Prowlarr_GKE.md @ e69407af sha256:957507214906 -->

# Prowlarr sur GKE Autopilot {#prowlarr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Prowlarr_GKE.png" alt="Prowlarr sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Prowlarr est le **gestionnaire d'indexeurs** central de la suite d'automatisation
des médias *arr — Sonarr, Radarr, Lidarr et Readarr pointent tous vers Prowlarr
au lieu de configurer les indexeurs séparément dans chaque application ; Prowlarr
synchronise la configuration des indexeurs avec l'API de chaque application
connectée. Il est écrit en .NET, fait partie de la même lignée de code Servarr
que Sonarr/Radarr, et est sous licence GPL-3.0. Ce module déploie Prowlarr sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

**C'est la seule variante de plateforme de Prowlarr dans ce catalogue.** Un
`Prowlarr_CloudRun` module a été construit, déployé et diagnostiqué, puis
entièrement supprimé — voir le §3 pour le résultat complet. Il n'y a pas
d'alternative Cloud Run de repli ; GKE est la seule cible prise en charge.

Ce guide se concentre sur les services cloud que Prowlarr utilise et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Prowlarr sur RAD, et comment cela se compare {#what-prowlarr-costs-on-rad-and-how-that-compares}

**L'exécution de Prowlarr dans votre propre projet Google Cloud coûte environ 42,08 $ US/mois en infrastructure, plus des frais de module uniques de 40 crédits RAD** (dimensionnés à 1 vCPU / 1 GiB sur les pods GKE Autopilot). RAD facture les frais de module une seule fois, au moment du déploiement — jamais plus lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la marge de RAD — environ 67 crédits/jour — et les frais de module sont inférieurs de 10 %, à 36 crédits. Voir "Mettez-le en pause gratuitement" ci-dessous pour savoir comment un déploiement Prowlarr géré par RAD peut être arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits (une fois) | 36 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~42,08 $ US/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~67 crédits/jour, mesurés à l'heure au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| Frais de gestion de cluster GKE\* | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **42,08 $** |

\* Non inclus dans le total ci-dessus — il est partagé entre toutes les applications GKE exécutées dans le même projet, il est donc de 0 $ si c'est votre seul cluster GKE.

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel et directement comparable pour ce projet open source exact, donc la comparaison honnête est un serveur autogéré nu : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un Droplet DigitalOcean 2 vCPU/4 Go (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte de cette application (1 vCPU ou moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes, donc un boîtier autogéré nu dimensionné pour correspondre coûterait moins cher que les chiffres ci-dessus — mais vous seriez toujours responsable de chaque correctif, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour le même montant ou un montant similaire est une base de données gérée, des identifiants détenus par Secret Manager, une surveillance et une mise à jour en un clic, qu'un VPS nu ne vous offre pas gratuitement.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du système d'exploitation/de la base de données, effectuez et testez les sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret Manager et la surveillance gèrent les trois pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite
pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer le projet lui-même — la
suppression logicielle récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne détruit pas la base de données, aucune
VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé
pendant qu'il attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du
projet — demande à Google de restaurer le projet et de rattacher son compte
de facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes : c'est une vérification, pas une reconstruction, et une mise à
jour ne facture jamais les frais de module à nouveau. L'ensemble de la
restauration ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de
build pour une chaîne de déploiements typique. Ce qu'il faut : vous devez
être propriétaire du projet (pas seulement faire gérer sa facturation par
RAD), vous devez le restaurer vous-même dans les 30 jours — après cela,
Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, donc votre solde de crédits achetés doit
toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que
la plupart des études et des démonstrations utilisent). Google indique que la
plupart des services fonctionnent à nouveau pleinement dans les 36 heures
suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un
bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de
Cloud Storage explicitement désactivée, de sorte que le bucket de sauvegarde
est très probablement supprimé dès que vous supprimez le projet — même si le
projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé
ce déploiement et que vous souhaitez conserver ce travail, copiez une
sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela
n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **propre projet** (ou un projet géré par RAD au-delà
de sa fenêtre de restauration de 30 jours), est de supprimer Prowlarr
purement et simplement et de le redéployer plus tard. Un redéploiement coûte
à nouveau les frais de module plus les builds — environ **43-46 crédits** au
total pour ce module.

La suppression ne permet d'économiser de l'argent que si Prowlarr restait
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution — pour ce module, cela représente
environ 4 jours ou plus d'inactivité, sur la base de son propre coût
d'exécution de 42,08 $ US/mois ci-dessus. La majeure partie de ce coût
d'exécution est généralement la base de données et toute VM de fichier/cache
partagée, et ils ne s'arrêtent que si rien d'autre dans le projet ne les
utilise, de sorte que la suppression de cette application seule n'économise
que sa propre part de calcul si quelque chose d'autre partage le projet.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
copiez la dernière sauvegarde avant de la supprimer si vous voulez la
conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de
  sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  remet le projet et les déploiements deviennent ceux du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF,
  XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
frais propres de RAD et les estimations de crédits quotidiens ; [Resource
Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Prowlarr s'exécute en tant que pod de processus .NET unique, soutenu par une
base de données SQLite embarquée. Le déploiement relie un petit ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de processus .NET unique, 1 vCPU / 1 GiB par défaut |
| Base de données | aucune | Prowlarr gère la configuration de l'indexeur/synchronisation d'applications dans une base de données SQLite embarquée (mode WAL) — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | un PVC de bloc (par défaut), ou Cloud Storage | `stateful_pvc_enabled = true` par défaut — un véritable PVC de bloc monté à `/config` ; un bucket GCS `storage` existe mais n'est pas utilisé comme montage sauf si le PVC est désactivé |
| Cache et file d'attente | aucun | Prowlarr n'a pas de dépendance Redis ou de file d'attente (`enable_redis` codé en dur `false`) |
| Secrets | Secret Manager | **Aucun généré** — Prowlarr n'a pas de compte administrateur intégré ni de clé de chiffrement à protéger |
| Ingress | Cloud Load Balancing | LoadBalancer externe une fois que `service_type = "LoadBalancer"` est défini ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données d'aucune sorte.** `Prowlarr_Common` corrige `database_type =
  "NONE"` — le seul état persistant de Prowlarr est son propre fichier SQLite
  embarqué.
- **Image officielle, non modifiée.** `container_image_source = "prebuilt"`
  déploie `lscr.io/linuxserver/prowlarr` directement — pas de Dockerfile, pas
  de build personnalisé, pas de traduction de point d'entrée.
- **PVC de stockage par blocs par défaut, pas GCS FUSE.** `stateful_pvc_enabled =
  true` exécute Prowlarr en tant que StatefulSet avec un PVC par pod monté à
  `/config`. C'est délibéré, pas fortuit — SQLite en mode WAL a besoin d'un
  véritable verrouillage de fichiers POSIX, que GCS FUSE ne fournit pas de
  manière fiable, et ce catalogue a un historique documenté de GCS FUSE
  corrompant d'autres applications SQLite en mode WAL (voir UptimeKuma).
  `stateful_pvc_storage_class` par défaut à
  `standard` (HDD `pd-standard`), **pas** SSD — l'état de configuration de Prowlarr est
  minuscule sans besoin d'IOPS élevés, il tire donc de la
  `DISKS_TOTAL_GB` régionale beaucoup plus grande au lieu du quota
  `SSD_TOTAL_GB` serré.
- **Instance unique, non négociable.** `min_instance_count = 1` et
  `max_instance_count = 1` — la base de données SQLite embarquée est un
  rédacteur unique.
- **`service_type` nécessite une surcharge explicite.** La valeur par défaut
  héritée de la fondation est `"ClusterIP"` ; Prowlarr a une véritable interface
  utilisateur web que les opérateurs doivent atteindre, alors définissez
  `service_type = "LoadBalancer"` au moment du déploiement.
- **Pas de connexion par défaut.** Il n'y a pas de secret généré ni de compte
  administrateur intégré — configurez l'authentification (si souhaité) à
  partir de l'interface utilisateur web **Settings → General → Security**
  après le premier déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Prowlarr {#a-gke-autopilot--the-prowlarr-workload}

- **Console :** GKE → Workloads → sélectionnez le StatefulSet `prowlarr` pour
  l'état du pod, l'utilisation des ressources et les logs.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

### B. Stockage — un PVC de bloc (par défaut) ou Cloud Storage {#b-storage--a-block-pvc-default-or-cloud-storage}

- **Console :** Kubernetes Engine → Storage, ou Cloud Storage → Buckets
  (filtrer par le préfixe du locataire).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                                    # stateful_pvc_enabled = true (default)
  gcloud storage buckets list --project "$PROJECT" --filter="name~prowlarr"   # only mounted if the PVC is disabled
  ```

### C. Secret Manager {#c-secret-manager}

Prowlarr ne crée pas ses propres secrets, mais l'empreinte Secret Manager de
la charge de travail (secrets de plateforme partagés, liaisons Workload
Identity) vaut toujours la peine d'être vérifiée si vous ajoutez des
`secret_environment_variables` personnalisés :

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~prowlarr"
  ```

### D. Réseau et ingress {#d-networking--ingress}

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  echo "$EXTERNAL_IP"
  ```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

- **Console :** Logging → Logs Explorer, filtre
  `resource.type="k8s_container" resource.labels.namespace_name="<namespace>"`.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Prowlarr {#3-prowlarr-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y
  a pas de job `db-init` — Prowlarr crée et migre son propre schéma SQLite
  (`prowlarr.db`, mode WAL) à
  `/config` au premier démarrage.
- **Pas de compte administrateur par défaut.** L'authentification est
  désactivée jusqu'à ce que vous l'activiez dans l'interface utilisateur web
  (**Settings → General → Security**) ; il n'y a pas de "admin/admin" ou
  d'identifiant de première connexion bien connu à modifier.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `GET /ping`, qui renvoie `200 {"status":"OK"}` non authentifié. C'est une
  véritable correction par rapport à la source de clonage originale de ce
  module, qui pointait les deux sondes vers `/api/health` (un chemin qui n'existe
  pas sur Prowlarr).
- **Inspecter l'exécution du job** (pertinent uniquement si vous fournissez
  des `initialization_jobs` personnalisés — aucun n'est exécuté par défaut) :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

### ⚠ Pourquoi il n'y a pas de variante Cloud Run : s6-overlay vs. gVisor {#-why-there-is-no-cloud-run-variant-s6-overlay-vs-gvisor}

C'est la découverte la plus importante spécifique à la plateforme pour ce
module — le résultat de trois déploiements de diagnostic en direct
systématiques et distincts qui ont exclu le stockage et les ressources avant
de conclure que la cause profonde était le système d'initialisation du
conteneur lui-même.

**Le problème.** L'image officielle `lscr.io/linuxserver/prowlarr`, comme
toutes les images LinuxServer.io, utilise **s6-overlay** comme PID 1 — un
système de supervision qui exécute lui-même le processus de l'application
après avoir exécuté sa propre séquence d'initialisation (corrections de
permissions, démarrage du service, etc.). Cloud Run exécute les conteneurs
dans **gVisor**, un bac à sable en espace utilisateur qui intercepte et
émule les appels système Linux. Sur Cloud Run, le conteneur Prowlarr n'a
produit **aucune sortie** — pas même la bannière de démarrage s6-overlay qui
s'affiche normalement en quelques millisecondes sur toute autre plateforme —
et Cloud Run a signalé **"Application exec likely failed"** à chaque fois.

**Comment cela a été isolé.** Trois déploiements de diagnostic en direct,
changeant une variable à la fois :

1. **Configuration par défaut** — échoue de manière identique : aucune
   sortie, échec d'exécution.
2. **Avec un volume GCS ajouté** (au cas où le montage lui-même serait le
   bloqueur) — échoue de manière identique.
3. **Avec une augmentation du CPU/mémoire** (au cas où la séquence
   d'initialisation de s6-overlay expirerait simplement sous des ressources
   limitées) — échoue de manière identique.

Les trois tentatives ont produit exactement le même symptôme sans variation,
excluant le stockage et le dimensionnement des ressources comme cause et
isolant l'échec au processus d'initialisation lui-même étant incompatible
avec le bac à sable gVisor — pas une erreur de configuration qui pourrait
être corrigée avec des entrées différentes.

**Le résultat.** `Prowlarr_CloudRun` a été construit, déployé, diagnostiqué, et
ensuite **entièrement retiré du catalogue** — la même disposition déjà
appliquée à Kopia, RocketChat et LobeChat, chacun retiré pour sa propre
incompatibilité au niveau de la plateforme plutôt que laissé dans un état
définitivement cassé. `Prowlarr_GKE` n'a pas une telle restriction : GKE exécute
des conteneurs sur de vrais nœuds Linux (les nœuds gérés d'Autopilot), donc
s6-overlay s'exécute exactement comme sur n'importe quel hôte Docker
standard — confirmé en direct, le pod signale `1/1
Running` et `/ping` renvoie `200` à la fois en interne
(`kubectl exec ... wget`) et en externe une fois que l'IP du LoadBalancer est
provisionnée.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Prowlarr sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `prowlarr` | Nom de base des ressources. |
| `application_display_name` | `Prowlarr` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Transmis directement comme tag de l'image officielle — pas de build personnalisé, donc pas d'ARG de build de version épinglée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie `lscr.io/linuxserver/prowlarr` directement. Correctement transféré à `App_GKE` (contrairement à certains modules pré-construits où cette variable est inerte). |
| `container_port` | `9696` | Fixé via `Prowlarr_Common` ; non transféré à `App_GKE` directement. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Les deux sont épinglés à `1` — la base de données SQLite embarquée est un rédacteur unique. |
| `enable_image_mirroring` | `true` | Met en miroir l'image officielle dans Artifact Registry pour éviter les limites de débit de Docker Hub, même si l'image elle-même n'est pas modifiée. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | **Surcharger à `LoadBalancer`.** La valeur par défaut héritée est écrite en tenant compte des charges de travail internes/de type base de données ; Prowlarr a une véritable interface utilisateur web qui nécessite une accessibilité externe. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (la valeur par défaut) — pas besoin de définir les deux. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Valeur par défaut délibérée** — donne à la base de données SQLite embarquée en mode WAL un véritable verrouillage de fichiers POSIX, que GCS FUSE ne fournit pas de manière fiable. |
| `stateful_pvc_mount_path` | `/config` | Où Prowlarr conserve `prowlarr.db` et tout autre état de l'application. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, pas SSD — l'état de configuration/SQLite de Prowlarr est petit sans besoin d'IOPS élevés ; évite le quota `SSD_TOTAL_GB` serré en faveur du quota `DISKS_TOTAL_GB` beaucoup plus grand. |
| `stateful_fs_group` | `3000` | Rend le PVC inscriptible par le groupe ; Prowlarr s'exécute en tant que UID 1000 / GID 2000. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/ping` | Les sondes réellement appliquées au Pod (transmises via `Prowlarr_Common`). Confirmé en direct : `200 {"status":"OK"}`, non authentifié. |
| `startup_probe_config` / `health_check_config` | HTTP `/api/health` (obsolète) | **Inerte pour Prowlarr** — `App_GKE` préfère toujours les `startup_probe`/`liveness_probe` par application ci-dessus lorsqu'un module en fournit un, de sorte que ces variables de niveau supérieur n'atteignent jamais la spécification du Pod malgré leur valeur par défaut obsolète. |
| `uptime_check_config` | `{ enabled = false, path = "/api/health" }` | **Pas inerte.** Désactivé par défaut, mais si vous activez le test de disponibilité de Cloud Monitoring, surchargez `path = "/ping"` — cette variable est appliquée telle quelle, contrairement aux deux précédentes. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Provisionné mais **non utilisé comme montage** tant que `stateful_pvc_enabled = true` (la valeur par défaut) — le PVC de bloc prend le relais de `/config` à la place. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Prowlarr_Common` — Prowlarr n'a pas de base de données SQL. |

### Groupe 19 — Domaine personnalisé et réseau {#group-19--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Le déploiement testé/de référence a utilisé `false` (IP éphémère) après avoir atteint le plafond de quota d'IP statiques globales du projet — il est sûr de laisser `false` pour Prowlarr, qui n'intègre aucune URL auto-référente dans sa propre configuration au démarrage. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `storage_buckets` | Le bucket `storage` (non utilisé comme montage tant que `stateful_pvc_enabled = true`). |
| `statefulset_name` | Nom du StatefulSet (le type de charge de travail par défaut). |
| `kubernetes_ready` | Si la charge de travail a atteint l'état Prêt. |
| `container_image` / `container_registry` | La référence de l'image déployée et le référentiel Artifact Registry. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

La validation au moment de la planification détecte le conflit de mise à
l'échelle min/max, l'exigence d'informations d'identification IAP et le
conflit StatefulSet/`workload_type` avant l'application — mais plusieurs
paramètres qui passent la validation ont toujours une valeur par défaut
incorrecte ou dangereuse qu'il est bon de connaître avant de déployer.

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `service_type` | `LoadBalancer` | Élevé | La valeur par défaut héritée est `ClusterIP` — l'interface utilisateur web de Prowlarr est inaccessible depuis l'extérieur du cluster tant que cela n'est pas explicitement défini. |
| Déploiement sur Cloud Run | Ne pas faire — utiliser `Prowlarr_GKE` (la seule variante prise en charge) | Critique | Le processus d'initialisation s6-overlay de l'image ne peut pas s'exécuter dans le bac à sable gVisor de Cloud Run — confirmé via 3 déploiements de diagnostic, tous échouant de manière identique sans aucune sortie de conteneur. Il n'y a pas de correction de configuration ; un module `Prowlarr_CloudRun` a été construit, testé et supprimé pour cette raison exacte. |
| `stateful_pvc_enabled` | `true` (la valeur par défaut) | Élevé | Le désactiver revient à un montage GCS FUSE à `/config`, qui ne prend pas en charge de manière fiable le verrouillage de fichiers POSIX dont la base de données SQLite en mode WAL de Prowlarr a besoin — ce catalogue a un historique documenté de GCS FUSE corrompant d'autres applications SQLite en mode WAL. |
| `stateful_pvc_storage_class` | Laisser à `standard` (HDD) | Faible–Moyen | Passer à `standard-rwo`/`premium-rwo` (SSD) puise dans le quota `SSD_TOTAL_GB` beaucoup plus serré sans réel avantage — le modèle d'E/S du fichier de configuration de Prowlarr n'a pas besoin d'IOPS SSD. |
| `max_instance_count` | Laisser à `1` | Critique | La base de données SQLite embarquée est un rédacteur unique ; augmenter cela risque de corrompre la base de données. |
| `uptime_check_config.path` | Surcharger à `/ping` si vous activez les tests de disponibilité | Moyen | La valeur par défaut de la variable `path` est un `/api/health` obsolète provenant de la source de clonage de ce module — contrairement à `startup_probe`/`liveness_probe`, celui-ci n'est *pas* surchargé ailleurs, donc un test de disponibilité activé avec le chemin par défaut échouera contre un chemin qui n'existe pas. |
| Authentification | L'activer depuis les paramètres de l'interface utilisateur web → Général → Sécurité après le premier déploiement | Élevé | Prowlarr est livré sans compte administrateur intégré et sans secret généré — une instance accessible via Internet et non authentifiée est exposée par défaut tant que vous ne la configurez pas. |

---

Pour le comportement de la fondation référencé tout au long — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Prowlarr est décrite dans **[Prowlarr_Common](Prowlarr_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Prowlarr sur GKE Autopilot](../labs/Prowlarr_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Prowlarr Common — Configuration d'application partagée](Prowlarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md), [Jellystat sur GKE Autopilot](Jellystat_GKE.md), [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Media Server**.
