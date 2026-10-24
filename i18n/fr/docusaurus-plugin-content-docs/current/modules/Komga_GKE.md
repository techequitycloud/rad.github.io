---
title: "Komga sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Komga sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Komga_GKE.md @ 1665a43e sha256:6fd9457e606b -->

# Komga sur GKE Autopilot {#komga-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Komga_GKE.png" alt="Komga sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Komga est un serveur multimédia gratuit, open source et auto-hébergé pour les
bandes dessinées, les mangas et les collections de livres numériques
(Kotlin/Java, Spring Boot). Il fournit une interface utilisateur de lecture web
claire, des flux OPDS, des collections, des listes de lecture et une recherche
en texte intégral dans votre bibliothèque. Ce module déploie Komga sur **GKE
Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Komga et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte Komga sur RAD, et comment cela se compare {#what-komga-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Komga sur RAD coûte environ 42 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 40 crédits (4,00 $ US).** GKE convient à Komga fonctionnant aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Komga_CloudRun.md) exécute le même Komga pour environ 33 $ US par mois. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 42 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US au prix de la recharge) | 36,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2010 par mois (environ 201 $ US au prix de la recharge, 161 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins sur un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 42 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun fournisseur ne vend de Komga SaaS hébergé** — il est auto-hébergé par
  conception.
- **Komga est léger** (1 vCPU/1 GiB), donc un petit VPS autogéré (bien en
  dessous de la classe de comparaison habituelle de 2 vCPU/4 Go, 24 $/mois) peut
  l'exécuter directement, plus votre propre temps pour les sauvegardes et les
  correctifs ; un pod GKE supporte le coût de base du cluster, quelle que soit
  la faible exigence de l'application elle-même.
- Ou consultez le [guide Cloud Run](Komga_CloudRun.md) pour l'option à moindre
  coût, qui se met également à l'échelle zéro lorsque personne ne lit.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Komga fonctionne dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à Komga dont vous n'avez besoin qu'occasionnellement —
un projet de cours, une démo, une évaluation de courte durée — que de le faire
fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime
  pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours.
  Comme la facturation est déjà déliée, rien n'est facturé pendant cette
  attente. Contrairement à la suppression d'un module, cela ne détruit pas les
  ressources de calcul de Komga une par une — l'ensemble du projet, et tout ce
  qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans
  les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture plus jamais les frais de
  module. Pour Komga derrière un petit Services_GCP et Project_GCP, cela
  représente **une poignée de crédits (moins de 1 $ US)** au total, contre les
  45 crédits que coûte un redéploiement complet.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un
  projet que vous apportez et dont RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du
  palier (100 crédits pour le palier sandbox que la plupart des utilisations
  d'étude et de démonstration conviennent). Google indique que la plupart des
  services sont de nouveau pleinement fonctionnels dans les 36 heures suivant
  une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes nocturnes de Komga sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de
  Cloud Storage, il est donc très probable qu'il disparaisse dès que vous
  supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé Komga et que vous souhaitez conserver ce
  travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du
  projet) avant de supprimer, comme pour le workflow de redéploiement ci-dessous.
  Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à
l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet
géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le
déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 45 crédits (4,50 $ US), car RAD recrée le projet et les
  services partagés avant Komga. La suppression ne permet d'économiser de
  l'argent que si Komga devait rester inutilisé pendant environ quatre jours ou
  plus, à la fois dans votre propre projet (environ 1,40 $ US par jour) et dans
  un projet géré par RAD (67 crédits par jour).
- **Supprimez tout ce que Komga utilise.** La majeure partie du coût
  d'exécution ici est le calcul lui-même et, sur GKE, les frais de gestion du
  cluster une fois que ce projet exécute plus d'un cluster — donc la
  suppression de Komga alors que quelque chose d'autre partage le projet et son
  cluster n'économise que le propre pod de Komga.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
  la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Komga
  pour une classe. Chaque participant dispose de Komga dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places à
  l'avance, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  Komga pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la
  facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin de l'engagement, le
  partenaire transfère le projet, et les déploiements deviennent la propriété
  du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et l'estimation quotidienne de 67 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets
Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Komga s'exécute en tant que pod JVM unique, recommandé comme StatefulSet avec un
PVC de type bloc. Le déploiement relie un ensemble minimal de services Google
Cloud — il n'y a pas de base de données externe :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod JVM (Spring Boot), 1 vCPU / 1 GiB par défaut ; réplica unique |
| Base de données | Aucune | Komga utilise une base de données SQLite embarquée sous `/config` — aucune instance Cloud SQL n'est créée |
| Stockage d'objets / stockage de blocs | Cloud Storage (GCS FUSE) ou PVC | `stateful_pvc_enabled = true` (par défaut) monte un véritable PVC de type bloc à `/config` ; désactivez-le pour utiliser un bucket basé sur GCS-FUSE à la place |
| Secrets | Secret Manager | Aucun généré — Komga n'a pas de secret de service injectable |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** Komga stocke son index de bibliothèque,
  ses utilisateurs, sa progression de lecture et ses paramètres dans une base
  de données SQLite embarquée — confirmé via le problème #1327 en amont (demande
  de fonctionnalité ouverte et non implémentée pour la prise en charge d'une
  base de données externe). `database_type = "NONE"`, `enable_redis` forcé `false`.
- **Image officielle pré-construite.** `container_image_source = "prebuilt"` déploie `gotson/komga`
  directement — pas d'étape Cloud Build. `enable_image_mirroring = true` la met en miroir dans
  Artifact Registry (copie sensible au digest) pour éviter les limites de débit
  de Docker Hub.
- **Le PVC de stockage de blocs est la disposition recommandée.** `stateful_pvc_enabled = true` par
  défaut exécute Komga en tant que StatefulSet avec un PVC par pod monté à
  `/config` — l'absence de verrouillage de fichier réel de gcsfuse corrompt les
  fichiers WAL SQLite, donc un volume de blocs réel est préféré à GCS FUSE pour
  une utilisation en production.
- **Instance unique uniquement.** `min_instance_count = 1` et `max_instance_count = 1` — Komga
  sert une bibliothèque SQLite partagée à partir d'un seul volume ; ne pas
  mettre à l'échelle au-delà de 1.
- **S'exécute en tant que root.** Le conteneur de Komga n'a pas de directive
  `USER` (confirmé via des tests de conteneur locaux), donc aucune solution de
  contournement d'option de montage uid/gid gcsfuse/PVC n'est nécessaire.
- **Aucun secret généré.** Le compte administrateur est créé
  interactivement via l'assistant de configuration de première exécution de
  Komga à `/` — il n'y a pas de clé principale ou de secret JWT à
  initialiser à l'avance.
- **Le point de terminaison de santé est `/actuator/health`.** Confirmé via des tests de
  conteneur locaux pour renvoyer `200 {"status":"UP"}` non authentifié. Le chemin
  versionné `/api/v1/actuator/health` est protégé par authentification (401) — ne pas y
  pointer les sondes.
- **Le dimensionnement du tas JVM est facultatif.** `jvm_heap_max` (vide par défaut)
  définit `-Xmx` via `JAVA_TOOL_OPTIONS`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Komga {#a-gke-autopilot--the-komga-workload}

Le pod de Komga est planifié sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par le pod. Avec `stateful_pvc_enabled = true` (par défaut), la charge de
travail est un StatefulSet avec une identité de pod stable et son propre PVC.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Komga pour voir le pod, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Déploiement vs StatefulSet).

### B. Stockage — l'état persistant de Komga {#b-storage--komgas-persistent-state}

Par défaut, un véritable **PersistentVolumeClaim** de type bloc est monté à
`/config`, contenant la base de données SQLite embarquée, l'index de
recherche Lucene, le cache de vignettes et les journaux. Si `stateful_pvc_enabled = false`, un
bucket Cloud Storage est monté au même chemin via le pilote CSI GCS FUSE à la
place (utilisation légère uniquement — voir les mises en garde dans
[Komga_Common](Komga_Common.md)).

- **Console :** Kubernetes Engine → Stockage (PVC) ; Cloud Storage → Buckets
  (si mode GCS-FUSE).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT"     # if using the GCS bucket
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les détails de StorageClass.

### C. Secret Manager {#c-secret-manager}

Komga n'a pas de secret de service généré — le compte administrateur est créé
via l'assistant de configuration web. Secret Manager ne contient que les
entrées que vous ajoutez vous-même via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'adresse IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers
Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte
facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Komga {#3-komga-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` — Komga exécute ses propres migrations de schéma Flyway
  contre la base de données SQLite embarquée au premier démarrage (confirmé via
  les journaux de conteneur locaux : `org.flywaydb.core.FlywayExecutor`, `Successfully validated 90 migrations`).
- **Assistant de configuration de première exécution.** Ouvrez l'URL du service
  et complétez l'assistant de configuration à `/` pour créer
  l'utilisateur administrateur initial — il n'y a pas de credential pré-rempli
  et pas de chemin API/CLI pour en créer un de manière non interactive.
- **Ajouter une bibliothèque après la première connexion.** Une fois connecté,
  ajoutez une "bibliothèque" pointant vers un chemin de média monté et
  déclenchez une analyse. Il s'agit d'une étape manuelle de l'opérateur ; aucun
  job d'initialisation ne l'initialise.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/actuator/health` (non authentifié, `200 {"status":"UP"}` une fois prêt).
  N'utilisez **pas** `/api/v1/actuator/health` — confirmé via des tests locaux pour
  renvoyer `401
  Unauthorized` même lorsque l'application est entièrement saine.
- **Bibliothèque partagée unique, instance unique.** La base de données SQLite
  de Komga est un fichier unique sur un volume monté — l'exécution de plusieurs
  réplicas risque de la corrompre par des écritures concurrentes. Gardez
  `max_instance_count = 1`.
- **PVC de type bloc sur GCS FUSE.** Lorsque `stateful_pvc_enabled = true`, `enable_gcs_storage_volume`
  est automatiquement défini `false` à l'intérieur de `Komga_Common`
  pour éviter un double montage à `/config`. Si le quota SSD du projet est
  contraint, remplacez `stateful_pvc_storage_class = "standard"` (HDD) — le modèle d'accès SQLite de
  Komga n'a pas besoin d'IOPS SSD.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Komga sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `komga` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image, transmis directement comme tag `gotson/komga`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `gotson/komga` — pas d'étape de build. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; augmenter pour les très grandes bibliothèques. |
| `min_instance_count` | `1` | Maintenir à `1` pour éviter les démarrages à froid pendant la reconstruction de l'index Lucene au démarrage. |
| `max_instance_count` | `1` | **Ne pas augmenter** — Komga sert une bibliothèque SQLite partagée unique. |
| `jvm_heap_max` | `""` | JVM `-Xmx` facultatif via `JAVA_TOOL_OPTIONS` (par exemple `"512m"`, `"1g"`). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Komga n'a pas de Cloud SQL — maintenir `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Komga dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé — définir `LoadBalancer` pour un accès externe direct. |
| `workload_type` | `null` (auto → `StatefulSet`) | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant requis — réplica unique. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL (permet à Komga de vider les écritures). |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Activer un PVC de type bloc par pod — recommandé pour Komga (gcsfuse corrompt sa base de données SQLite WAL). Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Taille de stockage du PVC par pod — taille pour contenir la configuration, les métadonnées de la bibliothèque et la base de données SQLite. |
| `stateful_pvc_mount_path` | `/config` | Chemin de montage du conteneur pour le PVC — `KOMGA_CONFIGDIR` de Komga. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass pour les PVC. Remplacer par `standard` (HDD) si le quota SSD est contraint. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` (sûr pour Komga) ou `Parallel`. |
| `stateful_update_strategy` | `null` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `3000` | `fsGroup` au niveau du pod. Komga s'exécute en tant que root, donc pas strictement requis, mais laissé défini pour la cohérence. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un ResourceQuota Kubernetes dans l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Nécessite un suffixe binaire (par exemple `4Gi`, `8192Mi`) lorsqu'il est activé — les entiers nus sont traités comme des octets et bloquent la planification des pods. |
| `quota_cpu_requests` / `quota_cpu_limits` / `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Dimensions de quota supplémentaires. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/actuator/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/actuator/health` | Sonde d'infrastructure de niveau App_GKE. |
| `health_check_config` | HTTP `/actuator/health` | Sonde de vivacité de niveau App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité facultatif de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga n'a pas besoin de job d'initialisation par défaut. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés, par exemple pour les tâches de maintenance de bibliothèque. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Komga. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket `storage` auto-provisionné (utilisé lorsque `stateful_pvc_enabled = false`). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires via le pilote CSI — par exemple, un bucket de bibliothèque de bandes dessinées/livres séparé, principalement en lecture seule. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 15 — Redis {#group-15--redis}

Non applicable — `enable_redis` est forcé `false` à l'intérieur de `Komga_GKE`.
Toutes les variables Redis sont déclarées pour la parité de convention.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Non applicable — `database_type` est fixé à `NONE`. Toutes les variables liées à la
base de données sont déclarées pour la parité de convention et transmises à la
fondation sans effet.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Non applicable — Komga n'a pas de base de données SQL. Déclaré pour la parité de
convention uniquement.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy sensible à l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant l'authentification propre à Komga. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Komga. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs de configuration (vides par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification. La plupart
> des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critique | Plusieurs pods écrivant simultanément le même fichier SQLite risquent de corrompre la base de données. |
| Chemin de la sonde de santé | `/actuator/health` | Critique | `/api/v1/actuator/health` est protégé par authentification (401) — l'utiliser comme chemin de sonde signifie que le pod ne devient jamais prêt même si Komga est entièrement sain. |
| `stateful_pvc_enabled` vs `enable_gcs_storage_volume` | Laisser `Komga_Common` basculer automatiquement | Critique | L'activation des deux monte deux volumes au même chemin `/config` — un conflit de double montage. |
| `stateful_pvc_storage_class` | `standard-rwo`, remplacer par `standard` en cas de contrainte SSD | Moyen | Les PVCs basés sur SSD utilisent le quota strict `SSD_TOTAL_GB` ; une campagne de mise à l'échelle zéro peut l'épuiser. |
| Assistant de configuration de première exécution | Compléter rapidement après le déploiement | Élevé | Un assistant de configuration non réclamé laisse l'instance sans compte administrateur ; quiconque atteint l'URL en premier peut le réclamer. |
| `min_instance_count` | `1` | Moyen | Le redémarrage du pod unique déclenche une latence de démarrage à froid, y compris une reconstruction de l'index Lucene. |
| `memory_limit` | `1Gi`, augmenter pour les grandes bibliothèques | Moyen | Une mémoire sous-dimensionnée peut provoquer un OOM-kill lors d'une analyse de grande bibliothèque. |
| `container_image_source` | `prebuilt` | Moyen | Passer à `custom` sans Dockerfile échoue la build — Komga n'a pas besoin de build personnalisée. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser le pod pendant la maintenance sans protection. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Komga
partagée avec la variante Cloud Run est décrite dans
**[Komga_Common](Komga_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Komga sur GKE Autopilot](../labs/Komga_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Komga sur Google Cloud Run](Komga_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Komga Common — Configuration d'application partagée](Komga_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md), [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Bibliothèque numérique**.
