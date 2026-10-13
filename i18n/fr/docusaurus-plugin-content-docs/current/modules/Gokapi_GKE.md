---
title: "Gokapi sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Gokapi sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gokapi_GKE.md @ e69407af sha256:1822e7c89a06 -->

# Gokapi sur GKE Autopilot {#gokapi-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gokapi_GKE.png" alt="Gokapi sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gokapi est un serveur de partage de fichiers léger et auto-hébergé écrit en Go
— une alternative auto-hébergée à WeTransfer. Les utilisateurs téléchargent des
fichiers et génèrent des liens de téléchargement partageables avec des dates
d'expiration, des limites de nombre de téléchargements et une protection par
mot de passe optionnelles, le tout soutenu par une base de données SQLite
interne (aucune base de données externe requise). Ce module déploie Gokapi sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services Google Cloud que Gokapi utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Gokapi sur RAD, et comment cela se compare {#what-gokapi-costs-on-rad-and-how-that-compares}

**L'exécution de Gokapi dans votre propre projet Google Cloud coûte environ 42,08 $ US/mois en frais Google Cloud, en plus d'un coût de module RAD unique de 75 crédits** (67,5 crédits — 10 % de moins — dans un projet géré par RAD). Gokapi est un serveur de partage de fichiers léger et auto-hébergé écrit en Go. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettre en pause gratuitement" ci-dessous.

*Gokapi est également disponible sur Cloud Run — voir le [guide Cloud Run](Gokapi_CloudRun.md) pour l'option moins chère ; ce guide couvre la variante GKE.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **75 crédits** (une seule fois) | **67,5 crédits** (une seule fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une seule fois, par build) | ~3–6 crédits (une seule fois, par build) |
| Coût d'exécution Google Cloud | ~42,08 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~67 crédits/jour (~6,70 $ US/jour), facturé à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **42,08 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officielle hébergée/cloud de Gokapi pour comparer,
  donc la comparaison honnête se fait avec une infrastructure auto-gérée, et non
  avec un SaaS concurrent.
- Un VPS nu d'environ 1 vCPU / 1 GiB — un Hetzner CPX22 (2 vCPU/4GB, ~24 $ US/mois),
  un DigitalOcean 2 vCPU/4GB Droplet (24 $ US/mois), ou le propre Compute Engine
  e2-standard-2 de GCP (2 vCPU/8GB, ~49 $ US/mois) — est généralement moins cher
  que le prix affiché par RAD ; un VPS d'une ou deux tailles inférieures serait
  encore moins cher.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : patcher le
  système d'exploitation, faire tourner les sauvegardes de base de données,
  renouveler les certificats TLS et surveiller les temps d'arrêt. Les services
  Cloud SQL, Secret Manager et la surveillance gérés par RAD le font pour vous,
  ce qui est le véritable compromis, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes d'argent — ce n'est
  généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Gokapi est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le
payer entièrement sans le détruire. La suppression de ce projet délie d'abord
sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logique récupérable de 30 jours de Google. Contrairement
à la suppression du module Gokapi seul, cela ne supprime pas Cloud SQL, aucune
VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une
chaîne de déploiement typique de 2 à 3. Les frais de module de 67,5 crédits ne
sont pas facturés à nouveau.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
indique que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé Gokapi et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si Gokapi se trouve dans votre propre projet (ou si plus de 30 jours se sont
écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez
à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ
**75 + ~3–6 crédits** (~7,95 $ US) dans votre propre projet, ou **67,5 + ~3–6
crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Gokapi restait
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût d'exécution : environ **6 jours ou plus** d'inactivité
dans votre propre projet (par rapport à sa facture Google Cloud d'environ 42,08
$ US/mois), ou **environ 2 jours ou plus** d'inactivité dans un projet géré par
RAD (par rapport à ses ~67 crédits/jour).

Préservez d'abord les données : les sauvegardes nocturnes sont stockées dans un
bucket à l'intérieur du déploiement et sont supprimées avec celui-ci. Copiez
donc la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est mise en pause et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Gokapi s'exécute comme une seule charge de travail binaire Go sans base de
données externe. Le déploiement connecte un ensemble restreint et ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Un pod StatefulSet à conteneur unique sur le port `53842`, `1000m` CPU / `1Gi` mémoire par défaut |
| Base de données / métadonnées | **Aucune (SQLite interne)** | Pas de Cloud SQL — Gokapi écrit sa propre base de données SQLite sous `GOKAPI_CONFIG_DIR` ; `database_type` est fixé à `NONE` |
| Persistance des fichiers | PVC de bloc GKE (StatefulSet) | La base de données SQLite et les fichiers téléchargés résident tous deux sous `/data`, sur un Persistent Volume Claim par pod par défaut |
| Stockage d'objets | Cloud Storage (conditionnel) | Un bucket `storage` est toujours déclaré, mais n'est monté (via GCS FUSE) que lorsque le PVC StatefulSet est désactivé |
| Secrets | Secret Manager | Seulement une clé API d'opérateur **optionnelle** (`GOKAPI_API_KEY`) ; pas de secret généré obligatoire |
| Ingress | API Kubernetes Gateway | `enable_custom_domain = true` par défaut, donc un point de terminaison Gateway public (et une IP statique réservée) est provisionné dès la sortie de la boîte |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL, jamais.** `database_type` est fixé en dur à `NONE` par
  `Gokapi_Common` — toutes les variables de base de données génériques (`db_name`, `db_user`,
  `application_database_name`, etc.) sont transmises à la fondation uniquement pour
  la compatibilité de la mise en miroir des variables et n'ont aucun effet.
- **SQLite + fichiers téléchargés résident sur un véritable PVC de bloc par défaut, pas GCS FUSE.**
  `stateful_pvc_enabled = true` par défaut, ce qui résout également automatiquement
  `workload_type` en `StatefulSet` (pas besoin de définir les deux). Un PVC `standard-rwo` de 20 Gi
  (SSD) est monté à `/data` ; `GOKAPI_CONFIG_DIR=/data/config` (configuration + la
  base de données SQLite) et `GOKAPI_DATA_DIR=/data/data` (fichiers téléchargés) résident tous deux
  sous ce montage, de sorte qu'ils survivent aux redémarrages/redéploiements de pods. Cela est important car
  SQLite n'est pas sûr sur gcsfuse — le module évite explicitement cette combinaison en
  désactivant le volume GCS chaque fois que le PVC est activé (voir ci-dessous).
- **Le bucket GCS `storage` est toujours créé par défaut même s'il n'est pas
  monté.** `Gokapi_Common` déclare toujours un bucket suffixé par `storage`, et
  `create_cloud_storage = true` le provisionne par défaut — mais avec le PVC StatefulSet par défaut
  en place, `enable_gcs_storage_volume` est automatiquement défini sur
  `false` pour éviter un double montage à `/data`, de sorte que le bucket reste inutilisé à moins que vous
  ne désactiviez `stateful_pvc_enabled`.
- **Réplica unique par conception.** `min_instance_count = 1`, `max_instance_count = 1`.
  La base de données SQLite de Gokapi est à écriture unique ; il n'y a pas de mode distribué/cluster,
  donc ne pas dépasser 1 pod.
- **Aucun mot de passe administrateur n'est généré automatiquement.** Gokapi n'a pas de secret obligatoire — le
  compte administrateur est créé de manière interactive via l'assistant de configuration de première exécution de Gokapi à
  **`/setup`** (la sortie `setup_url`). Tant qu'il n'est pas terminé,
  toutes les autres pages — `/` inclus — répondent "Le serveur est en mode maintenance,
  veuillez réessayer dans quelques minutes".
- **Clé API d'opérateur optionnelle.** `enable_api_key` (par défaut `false`) génère un
  jeton aléatoire de 32 caractères, le stocke dans Secret Manager et l'injecte comme
  `GOKAPI_API_KEY` via un Secret Kubernetes natif (`explicit_secret_values`) plutôt
  que le chemin Secret Manager → SecretSync. Il s'agit d'un jeton de commodité uniquement —
  les propres clés API de téléchargement/téléchargement de Gokapi sont normalement générées à partir de l'interface utilisateur d'administration
  après la configuration.
- **Redis est désactivé de force.** La variante code en dur `enable_redis = false` à
  la fondation quelle que soit la valeur de la variable `enable_redis` — Gokapi n'a aucune
  utilité pour Redis.
- **Un point de terminaison public est provisionné dès la sortie de la boîte.** Contrairement à de nombreux modules d'application,
  `enable_custom_domain` est par défaut `true` et `reserve_static_ip` est par défaut
  `true`, même si `service_type` est par défaut `ClusterIP`. Cela donne à Gokapi un
  point de terminaison Gateway public fonctionnel par défaut — approprié pour une application dont le seul
  but est de générer des liens de téléchargement partageables. Voir [App_GKE](App_GKE.md) pour le
  mécanisme de nom d'hôte `<reserved-ip>.nip.io` par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Gokapi {#a-gke-autopilot--the-gokapi-workload}

Gokapi s'exécute par défaut comme un **StatefulSet** à pod unique (identité de
pod stable, politique de redémarrage `OrderedReady` et un PVC par pod). Autopilot
facture le CPU et la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Gokapi pour les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail StatefulSet vs Deployment.

### B. Stockage persistant — le PVC de bloc (et le bucket GCS inutilisé) {#b-persistent-storage--the-block-pvc-and-the-unused-gcs-bucket}

La base de données de métadonnées SQLite et tous les fichiers téléchargés
résident sous `/data` sur un PVC de bloc par pod (`stateful_pvc_enabled = true`, `20Gi`, `standard-rwo`/SSD par
défaut). Un bucket Cloud Storage `storage` est également déclaré et — à moins que
vous ne désactiviez le PVC — provisionné mais jamais monté.

- **Console :** Kubernetes Engine → Stockage pour le PVC ; Cloud Storage → Buckets
  pour le bucket (probablement inutilisé).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Voir [App_GKE](App_GKE.md) pour les mécanismes StatefulSet/PVC (Groupe 7) et la
considération de quota SSD `SSD_TOTAL_GB` sur les projets à quota limité.

### C. Secret Manager {#c-secret-manager}

Gokapi ne crée **aucun secret obligatoire**. Le seul secret que ce module peut
créer est le jeton de commodité d'opérateur `GOKAPI_API_KEY` optionnel, géré par `enable_api_key`
(par défaut `false`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le modèle d'injection et de rotation de Secret
Store CSI / secret natif.

### D. Réseau et ingress {#d-networking--ingress}

`enable_custom_domain = true` et `reserve_static_ip = true` sont tous deux des valeurs par défaut, de sorte qu'une
ressource Kubernetes Gateway API avec une IP externe statique réservée est
provisionnée automatiquement, même si le `Service` Kubernetes sous-jacent lui-même
est par défaut `ClusterIP`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le nom d'hôte `<reserved-ip>.nip.io` par défaut, les domaines
personnalisés, Cloud CDN et les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties standard et d'erreur des pods sont acheminées vers Cloud Logging ;
les métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte optionnelles sont disponibles
(`uptime_check_config` est désactivé par défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gokapi {#3-gokapi-application-behaviour}

- **Aucun job d'initialisation ne s'exécute par défaut.** `Gokapi_Common` ne fournit aucune entrée `initialization_jobs` par défaut — Gokapi gère son propre stockage et n'a pas besoin de base de données pour démarrer. Seuls les jobs fournis par l'utilisateur (pour le chargement ou la migration de données personnalisées) apparaîtront sous Kubernetes Jobs.
- **La configuration au premier démarrage est entièrement interactive.** Il n'y a pas de drapeau d'auto-installation et pas de mot de passe administrateur généré. Ouvrez **`/setup`** sur l'URL du service (la sortie `setup_url`) et l'assistant de Gokapi créera le compte administrateur ; `/` n'affiche que "Le serveur est en mode maintenance" jusque-là.
- **Où les données persistent physiquement.** Avec le `stateful_pvc_enabled =
  true` par défaut, `GOKAPI_CONFIG_DIR=/data/config` (la base de données de métadonnées SQLite et la configuration de l'application) et `GOKAPI_DATA_DIR=/data/data` (fichiers téléchargés) résident sur le même PVC de bloc par pod monté à `/data`. Si vous définissez plutôt `stateful_pvc_enabled = false`, le module réactive automatiquement le montage GCS FUSE du bucket `storage` au même chemin — acceptable pour une utilisation légère, mais avec une latence plus élevée pour les charges de travail gourmandes en SQLite que le PVC de bloc.
- **Écriture unique, pod unique.** `min_instance_count = 1` / `max_instance_count =
  1` par défaut. La base de données SQLite de Gokapi n'a pas de mécanisme de clustering/réplication, donc ne pas augmenter `max_instance_count` au-dessus de 1.
- **Les sondes de santé atteignent la racine publique, aucune authentification requise.** Les sondes de démarrage et de vivacité sont toutes deux **HTTP GET `/`** (racine publique de Gokapi, 200, non authentifiée — avant la configuration, c'est l'avis de maintenance, toujours 200) — démarrage : `initial_delay=15s, timeout=5s, period=10s,
  failure_threshold=10` ; vivacité : `initial_delay=30s, timeout=5s, period=30s,
  failure_threshold=3`.
- **Le port du conteneur est fixé à `53842`.** C'est le port natif de Gokapi, câblé via `GOKAPI_PORT=53842` et le `container_port` du module ; il n'est pas configurable via la variable générique `container_port` (qui est documentée comme n'ayant aucun effet sur ce module).
- **Vérifier le pod déployé et son état persistant :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /data/config /data/data
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=50
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Gokapi sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gokapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `f0rc3/gokapi` utilisé comme base de build personnalisée ; `latest` est épinglé à un tag connu et fonctionnel (`v1.9.6`) au moment du build via l'argument de build `GOKAPI_VERSION` spécifique à l'application. |
| `enable_api_key` | `false` | Génère une clé API aléatoire dans Secret Manager et l'injecte comme `GOKAPI_API_KEY`, un jeton de commodité d'opérateur uniquement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Limite de CPU pour le conteneur Gokapi. |
| `memory_limit` | `1Gi` | Limite de mémoire ; Gokapi est un binaire Go léger et nécessite peu de mémoire. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Maintenir à 1 — la base de données SQLite de Gokapi est à écriture unique sans mode distribué. |
| `container_port` | `53842` | Non transmis à la fondation ; le port de Gokapi est fixé à `53842` via `Gokapi_Common`. |
| `enable_cloudsql_volume` | `false` | Doit rester `false` — Gokapi n'a pas de base de données Cloud SQL. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessible de l'extérieur par défaut. Définissez `ClusterIP` pour rendre le Service interne uniquement et acheminer le point d'entrée public via la Gateway du Groupe 19 à la place (`enable_custom_domain`, ci-dessous). |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | La persistance est largement discutable avec un seul réplica. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un PVC de bloc par pod pour la base de données SQLite + les téléchargements ; fortement recommandé par rapport à GCS FUSE pour Gokapi. |
| `stateful_pvc_size` | `20Gi` | Taille pour contenir la base de données SQLite et tous les fichiers téléchargés. |
| `stateful_pvc_mount_path` | `/data` | Les deux `GOKAPI_CONFIG_DIR` (`/data/config`) et `GOKAPI_DATA_DIR` (`/data/data`) résident sous ce montage. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré (SSD) par défaut sur GKE Autopilot ; utilise le quota `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `3000` | Correspond à l'UID 1000 / GID 2000 de Gokapi afin que le PVC soit inscriptible par le groupe. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — Gokapi persiste via le PVC StatefulSet, et non via NFS partagé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Gokapi n'a pas de base de données SQL ; toutes les autres variables de base de données de ce groupe sont transmises uniquement pour la compatibilité de la mise en miroir des variables et n'ont aucun effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (inhabituel parmi les modules d'application) de sorte qu'un point de terminaison Gateway public existe dès la sortie de la boîte, correspondant à l'objectif de Gokapi de générer des liens partageables. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements, alimentant le nom d'hôte `<ip>.nip.io` par défaut. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré ; couche sur le point de terminaison Gateway par défaut. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Gokapi. |
| `gokapi_api_key_secret_id` | ID du secret Secret Manager pour la clé API d'opérateur optionnelle ; vide lorsque `enable_api_key` est `false`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, monté uniquement si le PVC StatefulSet est désactivé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé avec un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver entraîne un retour à un montage GCS FUSE pour la base de données SQLite — les sémantiques d'écriture de gcsfuse sont dangereuses pour SQLite et risquent une corruption des métadonnées lors d'une utilisation réelle. |
| `stateful_pvc_mount_path` | `/data` (laisser par défaut) | Critique | Les deux `GOKAPI_CONFIG_DIR` et `GOKAPI_DATA_DIR` sont calculés par rapport à ce chemin ; le modifier sans faire correspondre `environment_variables` annule la base de données SQLite et les téléchargements existants. |
| `max_instance_count` | `1` | Critique | La base de données SQLite de Gokapi est à écriture unique sans clustering ; l'exécution de plus d'un réplica risque une corruption de la base de données et des téléchargements incohérents. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Moyen | Convient pour une utilisation typique ; sur un projet à quota limité (par exemple, `SSD_TOTAL_GB` serré), remplacer par HDD `standard` selon [App_GKE](App_GKE.md) si le quota est rare — le modèle d'E/S de Gokapi ne nécessite pas d'IOPS de niveau SSD. |
| `create_cloud_storage` | `true` (par défaut) avec `stateful_pvc_enabled = true` | Moyen | Crée un bucket GCS `storage` inutilisé qui n'est jamais monté tant que le PVC est actif — définissez `create_cloud_storage = false` pour éviter le bucket inutile, ou laissez-le si vous pourriez désactiver le PVC plus tard. |
| `enable_api_key` (secret auto-généré) | Laissez `false` à moins que vous n'ayez besoin d'une clé pré-provisionnée | Faible | Le jeton n'est qu'une commodité ; les véritables clés API de téléchargement/téléchargement de Gokapi sont générées à partir de l'interface utilisateur d'administration, quel que soit ce paramètre. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_custom_domain` / `reserve_static_ip` | `true` / `true` (par défaut) | Moyen | La désactivation des deux laisse Gokapi accessible uniquement via `ClusterIP` interne, sans URL publique pour les liens de téléchargement qu'il génère — cela va à l'encontre du but de l'application pour le partage externe. |
| `enable_cloudsql_volume` | `false` | Faible | Le fait de le définir sur `true` injecte un sidecar Cloud SQL Auth Proxy inutile ; Gokapi ne l'utilise jamais. |
| `enable_nfs` | `false` | Faible | Gokapi persiste via le PVC StatefulSet par défaut ; l'activation de NFS ajoute une instance Filestore inutilisée à moins que vous ne désactiviez délibérément le PVC et que vous ne souhaitiez un stockage partagé à la place. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Gokapi
partagée avec la variante Cloud Run est décrite dans
**[Gokapi_Common](Gokapi_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gokapi sur GKE Autopilot](../labs/Gokapi_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gokapi Common — Configuration d'application partagée](Gokapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
