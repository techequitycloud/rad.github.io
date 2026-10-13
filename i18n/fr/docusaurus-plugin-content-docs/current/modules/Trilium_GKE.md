---
title: "Trilium sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Trilium sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Trilium_GKE.md @ e69407af sha256:984b930af76f -->

# Trilium sur GKE Autopilot {#trilium-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_GKE.png" alt="Trilium sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (le fork **TriliumNext** activement maintenu — pas le
`zadam/trilium` archivé) est une application de prise de notes hiérarchique, auto-hébergée et open source
avec une base de données SQLite embarquée. Ce module déploie Trilium sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Trilium et sur la façon de les explorer et de les
opérer depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes
communs à chaque application GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Trilium sur RAD, et comment cela se compare {#what-trilium-costs-on-rad-and-how-that-compares}

**L'exécution de Trilium sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 42,08 $ US/mois en frais Google Cloud** (environ 115,08 $ US si ce n'est pas votre seul cluster Autopilot), en plus de frais de module RAD uniques de 75 crédits (7,50 $ US) facturés une fois au moment du déploiement — plus élevés que les frais du module Cloud Run car cette variante n'exécute pas de volume NFS partagé et s'appuie plutôt sur le propre stockage du pod. GKE Autopilot convient à Trilium qui doit rester actif ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, consultez plutôt le [guide Cloud Run](Trilium_CloudRun.md). Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 42,08 $ US/mois, facturé par Google au prix catalogue | ~67 crédits/jour (environ 2010/mois, 201 $ US au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un forfait mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **42,08 $ US** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Trilium (le fork TriliumNext) n'a pas de version cloud hébergée officielle — il est distribué uniquement en tant que logiciel auto-hébergé, il n'y a donc pas de plan SaaS de fournisseur à comparer.
- Une comparaison auto-gérée, dimensionnée aux valeurs par défaut de Trilium de 1 vCPU / 1 Gio : un Hetzner CPX11 ou DigitalOcean 1 vCPU/2 Go Droplet coûte environ 6-12 $/mois, moins cher en termes de trésorerie que les deux options RAD ici — plus votre propre temps pour les sauvegardes, les correctifs du système d'exploitation et le renouvellement TLS.
- La majeure partie du coût de ce module est le pod GKE Autopilot lui-même et sa part des frais de gestion du cluster ; la [variante Cloud Run](Trilium_CloudRun.md) plus légère évite les deux.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne démolit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Trilium et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Trilium signifie redéployer à partir
de zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou environ
70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Trilium restait inutilisé suffisamment longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — environ 6 jours ou plus dans votre propre projet
(environ 1,40 $ US par jour), ou environ 1 jour ou plus dans un projet géré par RAD
(67 crédits par jour).

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Trilium s'exécute comme un seul pod Node.js/Express sur GKE Autopilot. Le déploiement relie
un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 1 vCPU / 1 Gio par défaut — mais voir les notes de mise à l'échelle ci-dessous |
| Base de données | Aucune (SQLite embarquée) | L'intégralité du magasin de documents de Trilium est un seul fichier SQLite, `document.db`, sur le volume persistant |
| Stockage persistant | PVC de bloc (par défaut) | PVC StatefulSet à `/home/node/trilium-data` ; définir `stateful_pvc_enabled = false` pour revenir à un volume GCS FUSE |
| Secrets | Secret Manager | Aucun généré — Trilium n'a pas de credential piloté par variable d'environnement |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut (Trilium est une interface utilisateur web accessible par navigateur) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucun moteur de base de données à gérer.** `database_type = "NONE"` — il n'y a pas d'instance Cloud SQL,
  pas de chaîne de connexion, et rien à sauvegarder séparément du volume de données.
- **Réplica unique uniquement.** `min_instance_count = max_instance_count = 1`. La base de données SQLite embarquée de Trilium
  ne prend pas en charge l'écriture multi-utilisateurs — l'exécution de plusieurs pods
  risque de corrompre la base de données en cas d'écritures concurrentes.
- **`service_type = "LoadBalancer"` par défaut.** Trilium est une interface utilisateur web accessible par navigateur,
  il est donc exposé en externe dès le départ (contrairement aux charges de travail de type base de données,
  qui sont par défaut `ClusterIP`).
- **Aucun credential pré-rempli.** Trilium n'a **pas** de bootstrap d'authentification piloté par variable d'environnement. Lors de la
  première visite, l'application elle-même présente un écran "Définir le mot de passe" ; complétez-le avant
  de partager l'URL.
- **La sonde de santé est `/api/health-check`, pas `/`.** Le chemin racine (`/`) renvoie une
  redirection 302 vers l'écran de configuration/connexion. Seul `/api/health-check` renvoie un
  `200 {"status":"ok"}` non authentifié — confirmé en direct via des tests de conteneur locaux.
- **PVC de bloc par défaut.** `stateful_pvc_enabled = true` (par défaut) maintient le
  fichier SQLite embarqué, qui s'exécute en mode WAL, hors de GCS FUSE — SQLite ne
  prend pas en charge WAL sur un système de fichiers réseau. La valeur par défaut `stateful_pvc_storage_class` est `"standard"`
  (HDD `pd-standard`) — Trilium n'a pas besoin d'IOPS SSD, et le HDD utilise le
  quota `DISKS_TOTAL_GB` beaucoup plus grand au lieu du quota `SSD_TOTAL_GB` restreint.
- **`fsGroup`/`mount_options` défini sur 1000.** Le conteneur de Trilium s'exécute en tant qu'utilisateur `node`,
  uid/gid 1000 (confirmé via `docker run ... id node`) ; sans correspondance
  de propriété, le volume monte en tant que root et l'application ne démarre pas.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Trilium {#a-gke-autopilot--the-trilium-workload}

Trilium s'exécute comme un seul pod (un StatefulSet par défaut, car
`stateful_pvc_enabled = true` ; un déploiement si vous désactivez le PVC). Comme il doit rester à exactement un réplica, il
n'y a pas d'autoscaling horizontal significatif à observer.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Trilium pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse
  IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la mise à l'échelle d'Autopilot et le type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud Storage / PVC de bloc — le répertoire de données Trilium {#b-cloud-storage--block-pvc--the-trilium-data-directory}

L'intégralité de l'état de l'application (SQLite `document.db`, pièces jointes, historique des révisions,
paramètres) se trouve sous `/home/node/trilium-data`, sur un PVC de bloc StatefulSet par
défaut (`stateful_pvc_enabled = true`), ou sur un volume GCS FUSE si le PVC est
désactivé.

- **Console :** Cloud Storage → Buckets (mode GCS FUSE) ; Kubernetes Engine → Stockage
  (mode PVC).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"          # GCS FUSE mode
  kubectl get pvc -n "$NAMESPACE"                             # PVC mode
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique
peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés et les adresses IP statiques.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Des tests de disponibilité et des stratégies d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Trilium {#3-trilium-application-behaviour}

- **Pas de job de configuration de base de données au premier déploiement.** Trilium crée et migre son propre
  schéma SQLite lors de la première visite web, via son propre assistant de configuration — il n'y a pas de
  job `db-init` géré par Terraform à inspecter.
- **Écran "Définir le mot de passe" lors de la première exécution.** La navigation vers l'URL racine pour la première
  fois présente un formulaire de configuration de mot de passe (pas d'administrateur/nom d'utilisateur par défaut — Trilium est une
  application mono-utilisateur). Il n'y a pas de credential pré-rempli dans Secret Manager à consulter.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health-check`, qui
  renvoie `200 {"status":"ok"}` une fois que le serveur HTTP est à l'écoute.
- **Contrainte d'écriture unique.** Ne jamais augmenter `max_instance_count` au-dessus de `1` — la
  base de données SQLite embarquée n'est pas sûre pour les écritures concurrentes de plusieurs pods.
- **Compromis PVC vs GCS FUSE.** Le PVC de bloc (par défaut) offre un véritable verrouillage de fichiers POSIX et le mappage de mémoire partagée dont le mode WAL de SQLite a besoin, au prix de la consommation de quota de disque régional (atténué ici en utilisant par défaut le HDD, pas le SSD).
  GCS FUSE n'a pas besoin de quota de disque mais n'est pas un système de fichiers pris en charge pour SQLite WAL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Trilium sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `trilium` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image Docker ; mappé en interne à un ARG de build épinglé (`TRILIUM_VERSION`). |
| `enable_password` | `false` | Réservé pour la parité avec les autres modules d'éditeur mono-utilisateur. **Aucun effet** — Trilium n'a pas de bootstrap de mot de passe piloté par variable d'environnement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; Trilium est léger, n'augmentez que pour de très grandes collections de notes. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Maintenir les deux à 1** — pas de support multi-écriture sur la base de données SQLite embarquée. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Trilium dans Artifact Registry avant le déploiement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Trilium est une interface utilisateur web accessible par navigateur, exposée en externe par défaut. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`, sinon `Deployment`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Garder `true` — véritable verrouillage de fichiers POSIX et support WAL pour le document SQLite.db. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/home/node/trilium-data` | Chemin de montage du conteneur. |
| `stateful_pvc_storage_class` | `standard` | HDD par défaut — pas besoin d'IOPS SSD ; maintient les déploiements hors du quota `SSD_TOTAL_GB` restreint. |
| `stateful_fs_group` | `1000` | Correspond à l'uid/gid de Trilium (l'utilisateur `node`). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non référencé — Trilium n'a pas de base de données SQL (SQLite embarquée uniquement). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/health-check`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel sur `/api/health-check`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Trilium. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | L'augmenter risque de corrompre la base de données SQLite embarquée par des écritures concurrentes. |
| `stateful_fs_group` / GCS mount_options | `1000` | Critique | Un uid/gid incorrect monte le répertoire de données en tant que root ; le processus Trilium non-root ne démarre pas. |
| Étape "Définir le mot de passe" lors de la première visite | Compléter immédiatement | Critique | Une instance Trilium sans mot de passe défini sur une IP de LoadBalancer publique est accessible par n'importe qui tant que le mot de passe n'est pas défini. |
| `startup_probe` / chemin `liveness_probe` | `/api/health-check` | Élevé | Pointer les sondes vers `/` entraîne une redirection 302, que la plupart des vérifications de santé HTTP traitent comme un échec, empêchant le pod de devenir Prêt. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Moyen | `standard-rwo` (SSD) utilise inutilement le quota `SSD_TOTAL_GB` restreint pour une charge de travail sans besoin d'IOPS. |
| `service_type` | `LoadBalancer` pour une utilisation normale | Moyen | Définir `ClusterIP` rend l'interface utilisateur de prise de notes inaccessible depuis un navigateur sans un port-forward. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Trilium partagée avec
la variante Cloud Run est décrite dans **[Trilium_Common](Trilium_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Trilium sur GKE Autopilot](../labs/Trilium_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Trilium sur Google Cloud Run](Trilium_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Trilium Common — Configuration d'application partagée](Trilium_Common.md) — la configuration partagée par les deux cibles de déploiement.
