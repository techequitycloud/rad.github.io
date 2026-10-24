---
title: "Kavita sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Kavita sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kavita_GKE.md @ e69407af sha256:048b103f57b2 -->

# Kavita sur GKE Autopilot {#kavita-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kavita_GKE.png" alt="Kavita sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kavita est un serveur de bibliothèque numérique et de lecture rapide, riche en
fonctionnalités, auto-hébergé pour les bandes dessinées, les mangas et les
livres électroniques — une interface utilisateur de lecture web propre, des
flux OPDS, des collections, des listes de lecture et une recherche en texte
intégral dans votre bibliothèque, construit sur .NET avec une base de données
SQLite interne. Ce module déploie Kavita sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Kavita utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Kavita sur RAD, et comment cela se compare {#what-kavita-costs-on-rad-and-how-that-compares}

**Kavita sur le module GKE de RAD coûte environ 42 US$ par mois dans votre
propre projet, plus des frais de module de 75 crédits (7,50 US$) une fois par
déploiement.** Si vous ne lisez que par intermittence plutôt que
continuellement, consultez "Mettez-le en pause gratuitement" ci-dessous pour
arrêter de payer sans perdre votre progression de lecture. Kavita est également
disponible en tant que module Cloud Run, qui est l'option la moins chère ici
(environ 19 US$/mois) — consultez le guide Cloud Run à moins que vous n'utilisiez
déjà GKE Autopilot pour d'autres applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42,08 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, moins sur un plan. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par toutes les applications du projet, donc une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (add-ons, sauvegardes) | 1,00 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 42,08 US$** |

### Comment cela se compare {#how-it-compares}

- Kavita n'a pas de plan SaaS hébergé officiel à comparer — il est livré
  purement comme un serveur de lecture auto-hébergé avec une base de données
  SQLite interne — donc la comparaison honnête est un serveur nu.
- L'empreinte de Kavita est légère (1 vCPU, 1 GiB), donc même un niveau VPS
  moins cher/plus petit que ceux ci-dessous exécuterait confortablement une
  bibliothèque personnelle ; à titre de référence, un Hetzner CPX22 ou
  DigitalOcean 2 vCPU/4 GB coûte environ 24 $/mois, et un GCP Compute Engine
  e2-standard-2 environ 49 $/mois.
- Ce que RAD ajoute par rapport à un VPS nu : persistance basée sur Cloud
  Storage, réseau et surveillance gérés — Kavita n'a pas besoin de service de
  base de données séparé, donc la majeure partie de la valeur ici est
  opérationnelle plutôt que d'administration de base de données.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Kavita fonctionne dans un projet géré par RAD pour vous et que vous
prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou
simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la
meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
demande à Google de supprimer purement et simplement le projet : la propre
suppression logicielle récupérable de Google de 30 jours. Contrairement à la
suppression de Kavita en tant que module unique, cela ne supprime pas le
service Cloud Run/GKE et le réseau un par un — l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 US$) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un que RAD ne gère que pour
la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, donc votre solde de crédits achetés doit toujours
dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart
utilisent). Google indique que la plupart des services fonctionnent à nouveau
pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet, même si le projet lui-même est récupérable
pendant 30 jours. L'exportation nocturne de Kavita couvre sa base de données
SQLite (progression de lecture, collections, listes de lecture) ; pour une
installation par défaut, c'est la seule copie qui vaille la peine d'être
conservée, car les fichiers source de votre bibliothèque proviennent
généralement d'ailleurs.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est
passée, la solution de repli est de supprimer Kavita purement et simplement et
de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les
  builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de
  temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de
  l'argent que si Kavita devait rester inutilisé pendant environ 6 jours ou
  plus dans votre propre projet (environ 1 jour ou plus dans un projet géré par
  RAD). La majeure partie du coût d'exécution ici est le coût de gestion du
  cluster GKE, donc la suppression de Kavita seule n'économise que la part de
  son propre pod si d'autres applications partagent le cluster.
- **Conservez les données en premier.** Les sauvegardes nocturnes sont écrites
  dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec
  lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous
  conservez) avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud :
supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Kavita fonctionne comme une seule charge de travail web .NET avec **aucune
base de données externe ni cache** — tout ce dont elle a besoin (paramètres, sa
base de données SQLite interne et l'index de la bibliothèque) vit sur le disque
sous `/kavita/config`.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod web .NET sur le port 5000, `1000m` CPU / `1Gi` mémoire par défaut |
| Base de données | **Aucune** — SQLite interne | `database_type` est fixé à `NONE` par `Kavita_Common` ; aucune instance Cloud SQL n'est créée |
| Persistance de l'état | PVC de bloc par pod (StatefulSet) | `/kavita/config` contient la base de données SQLite (`kavita.db`) et les paramètres de l'application ; **activé par défaut** (`stateful_pvc_enabled = true`) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné par `Kavita_Common`, mais n'est monté à `/kavita/config` que lorsque le PVC de bloc est désactivé |
| Secrets | Secret Manager | **Aucun généré** — l'assistant de configuration de première exécution crée le compte administrateur ; `secret_ids`/`secret_values` sont vides |
| Ingress | API Kubernetes Gateway | Service `ClusterIP` par défaut, exposé via la Gateway avec une IP statique réservée ; domaine personnalisé pris en charge |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite vit sur un vrai PVC de bloc, pas GCS FUSE.** `stateful_pvc_enabled` par défaut
  à `true`, donc Kavita fonctionne comme un `StatefulSet` avec un PVC de bloc par pod monté à
  `/kavita/config`. C'est délibéré : gcsfuse corrompt les index SQLite/média, donc le
  montage GCS FUSE (`enable_gcs_storage_volume`) n'est utilisé qu'en dernier recours lorsque le
  PVC de bloc est désactivé. Si vous définissez un jour `stateful_pvc_enabled = false`, la
  base de données SQLite et les métadonnées de la bibliothèque de Kavita se
  déplacent vers le bucket `storage` basé sur GCS FUSE à la place — ne
  faites cela que si vous comprenez le risque SQLite-sur-gcsfuse.
- **Le bucket GCS `storage` est créé de toute façon mais n'est monté que
  conditionnellement.** `Kavita_Common` déclare toujours une sortie de bucket
  `storage`, mais le wrapper GKE définit `enable_gcs_storage_volume = !stateful_pvc_enabled`, donc avec le
  PVC de bloc par défaut en place, ce bucket existe mais n'est **pas** monté
  dans le pod.
- **Réplica unique par défaut, et cela devrait rester ainsi.** `min_instance_count =
  1`,
  `max_instance_count = 1`. Kavita sert une bibliothèque SQLite partagée à partir d'un
  volume — il n'y a pas de clustering ou de coordination de stockage partagé,
  donc exécuter plus d'un réplica contre le même PVC est dangereux.
- **NFS est désactivé par défaut** (`enable_nfs = false`) — la persistance est gérée
  entièrement par le PVC StatefulSet, pas Filestore.
- **Pas de job de configuration de base de données au premier démarrage.** Kavita
  n'a pas de job `db-init`/migration ; `initialization_jobs` par défaut à une
  liste vide et seuls les jobs personnalisés que vous fournissez sont exécutés.
- **Pas de secrets auto-générés.** Contrairement à la plupart des modules
  d'application, Kavita n'a pas de mot de passe administrateur ou de clé API
  créé dans Secret Manager — le compte administrateur est créé via l'assistant
  de configuration de première exécution de l'interface web la première fois
  que vous ouvrez le service.
- **`session_affinity` est `None` et `service_type` est `ClusterIP`** — l'accès
  externe passe par l'API Gateway (`enable_custom_domain = true` par défaut) plutôt que
  par un service LoadBalancer directement exposé.
- **Redis est désactivé de force.** La valeur par défaut de la fondation
  `App_GKE` pour `enable_redis` est `true`, mais
  `Kavita_GKE`'s `main.tf` code en dur `enable_redis = false` — Kavita n'a
  aucune utilité pour Redis et cela ne peut pas être annulé via les variables
  du module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le
namespace et les autres identifiants sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. GKE Autopilot — la charge de travail Kavita {#a-gke-autopilot--the-kavita-workload}

Kavita fonctionne comme un `StatefulSet` par défaut (sélectionné
automatiquement car `stateful_pvc_enabled
= true`), donnant à chaque pod une identité stable et
son propre PVC. Comme il s'agit d'une application SQLite à réplica unique et
écrivain unique, ne la mettez pas à l'échelle horizontalement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Kavita pour les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app.kubernetes.io/name~kavita 2>/dev/null || \
    kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Stockage persistant — PVC de bloc (SQLite + métadonnées de la bibliothèque) {#b-persistent-storage--block-pvc-sqlite--library-metadata}

La configuration de Kavita, sa base de données SQLite interne (`kavita.db`)
et les métadonnées de la bibliothèque vivent toutes sous `/kavita/config`, qui
par défaut est un **Persistent Volume Claim de bloc par pod** (`stateful_pvc_enabled = true`,
`stateful_pvc_size = "20Gi"`, `stateful_pvc_storage_class = "standard-rwo"`). Il s'agit d'un véritable
stockage de bloc — pas d'un montage GCS FUSE — car gcsfuse corrompt les
fichiers SQLite et les fichiers d'index multimédia.

- **Console :** Kubernetes Engine → Storage pour le PVC ; Compute Engine → Disks
  pour le disque persistant sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~kavita"
  ```

`standard-rwo` est basé sur SSD (Balanced PD) et utilise le quota
`SSD_TOTAL_GB` du projet — voir [App_GKE](App_GKE.md) et les directives de classe de
stockage du dépôt pour savoir comment passer au HDD (`stateful_pvc_storage_class = "standard"`) si le
quota SSD est limité. La perte de ce PVC entraîne la perte de l'intégralité de
l'index de la bibliothèque Kavita, des paramètres et de la progression de la
lecture.

### C. Cloud Storage (le bucket `storage` non monté) {#c-cloud-storage-the-unmounted-storage-bucket}

`Kavita_Common` provisionne un bucket Cloud Storage (suffixe `storage`)
indépendamment de la disposition de stockage utilisée. Avec la disposition PVC
de bloc par défaut, il est créé mais non monté ; il n'est monté à
`/kavita/config` via GCS FUSE que lorsque `stateful_pvc_enabled = false`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~kavita"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages du pilote CSI
GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Kavita n'a **aucun secret généré** — aucun mot de passe administrateur, clé API
ou clé de signature n'est créé par ce module. Tous les secrets personnalisés que
vous configurez via `secret_environment_variables` transitent toujours par Secret Manager et le
pilote CSI Secret Store comme tout autre module d'application GKE.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kavita"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail utilise un service `ClusterIP` (`service_type = "ClusterIP"`)
exposé en externe via l'API Kubernetes Gateway (`enable_custom_domain =
true`) avec une IP
statique réservée (`reserve_static_ip = true`).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte facultatives sont disponibles
(`uptime_check_config` est désactivé par défaut pour ce module).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Kavita {#3-kavita-application-behaviour}

- **Pas de job de bootstrap de base de données.** Kavita gère son propre
  stockage SQLite entièrement à l'exécution ; `Kavita_Common` n'injecte aucun
  job `db-init`/migration, et `initialization_jobs` par défaut à
  `[]`.
- **Assistant de configuration au premier démarrage.** Il n'y a pas de compte
  administrateur pré-rempli ni de identifiant généré. Ouvrez l'URL du service
  — l'assistant de configuration au premier démarrage vous guide pour créer le
  compte administrateur initial et ajouter votre première bibliothèque.
- **La disposition du stockage est contrôlée par `stateful_pvc_enabled`.** Avec la valeur
  par défaut `true`, Kavita fonctionne comme un `StatefulSet` et
  `/kavita/config` (config + SQLite `kavita.db`) est un PVC de bloc
  (`stateful_pvc_size = "20Gi"`, classe de stockage `standard-rwo`, `stateful_fs_group = 3000`
  pour que le volume soit accessible en écriture par le groupe). Si vous le
  désactivez, `Kavita_Common` monte à la place le bucket GCS `storage` au
  même chemin via GCS FUSE (`enable_gcs_storage_volume = true` dans ce cas).
  `stateful_pod_management_policy` par défaut à `null` (la valeur par défaut
  `OrderedReady` d'App_GKE), qui est le paramètre sûr pour les redémarrages
  à écrivain unique de Kavita.
- **Écrivain unique, réplica unique.** `min_instance_count = 1` et
  `max_instance_count = 1` par défaut — Kavita n'a pas de mode distribué/clustering,
  donc n'augmentez pas `max_instance_count` tant qu'un seul PVC/base de données
  SQLite ne soutient pas la charge de travail.
- **Chemins des sondes de santé.** La sonde de démarrage (`startup_probe` /
  `startup_probe_config`) et la sonde de vivacité (`liveness_probe` /
  `health_check_config`) sont toutes deux **HTTP `GET /api/health`**, non
  authentifiées. La sonde de démarrage utilise un budget d'échec plus long
  (`initial_delay_seconds = 15`, `period_seconds = 10`, `failure_threshold = 10`) pour tolérer
  un indexation de bibliothèque plus lente au premier démarrage avant que la
  sonde de vivacité (`initial_delay_seconds = 30`, `period_seconds = 30`,
  `failure_threshold = 3`) ne prenne le relais.
- **Redis est désactivé de force.** Le `Kavita_GKE` de `main.tf`
  définit `enable_redis = false` inconditionnellement lors de l'appel de
  `App_GKE`, annulant la valeur par défaut `enable_redis = true` de la
  fondation — aucun `REDIS_HOST`/`REDIS_PORT` n'est jamais injecté.
- **Build d'image personnalisée.** Le conteneur est construit à partir d'un
  Dockerfile wrapper mince (`FROM jvmilazz0/kavita:${KAVITA_VERSION}`) ; `application_version = "latest"` se
  résout à l'argument de build `KAVITA_VERSION = 0.8.7` épinglé (une mise à jour de
  version nécessite de modifier la valeur épinglée dans `Kavita_Common`, pas
  seulement de redéployer).
- **Vérifiez la charge de travail et le PVC après le déploiement :**
  ```bash
  kubectl get statefulset,pvc,pods -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /kavita/config
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 5000:5000
  curl -s http://127.0.0.1:5000/api/health
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Kavita sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kavita` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Kavita` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tag d'image Kavita ; `latest` construit le `KAVITA_VERSION = 0.8.7` épinglé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Limite de CPU pour le conteneur Kavita. |
| `memory_limit` | `1Gi` | Limite de mémoire ; Kavita est un serveur .NET léger, confortable pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | **Maintenir à 1** — Kavita n'a pas de support de clustering/écriture partagée. |
| `container_port` | `5000` (fixé par `Kavita_Common`) | Non transmis à `App_GKE` ; le conteneur écoute toujours sur 5000. |
| `enable_cloudsql_volume` | `false` | Kavita n'a pas de Cloud SQL — laisser `false`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'accès externe passe par l'API Gateway, pas par un LoadBalancer direct. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant nécessaire avec un seul réplica. |

### Groupe 7 — StatefulSet / PVC de bloc {#group-7--statefulset--block-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Activé par défaut.** Provisionne le PVC de bloc par pod qui contient la configuration de Kavita + la base de données SQLite. |
| `stateful_pvc_size` | `20Gi` | Taille du volume de configuration/bibliothèque/SQLite ; augmenter pour les grandes collections. |
| `stateful_pvc_mount_path` | `/kavita/config` | Doit rester le répertoire de données de Kavita (config + `kavita.db`). |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré basé sur SSD ; utilise le quota `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `3000` | Rend le PVC accessible en écriture par le groupe pour le processus UID 1000 / GID 2000 de Kavita. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Requis pour des redémarrages sûrs de la charge de travail SQLite à écrivain unique. |

### Groupe 15 — Redis (inactif pour Kavita) {#group-15--redis-inert-for-kavita}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) | **Remplacé par `false`** dans le `Kavita_GKE` de `main.tf` quelle que soit cette valeur — Kavita n'utilise jamais Redis. |
| `redis_host` / `redis_port` / `redis_auth` | — | Transmis à la fondation pour compatibilité uniquement ; non applicable à Kavita. |

### Groupe 16 — Base de données (non applicable) {#group-16--database-not-applicable}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Kavita_Common` — Kavita stocke tout dans SQLite interne, aucune instance Cloud SQL n'est créée. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | L'ingress de l'API Gateway est activé par défaut pour Kavita. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |
| `enable_nfs` | `false` | Désactivé par défaut — la persistance se fait via le PVC de bloc, pas Filestore. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Namespace dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Kavita. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `storage`, monté uniquement lorsque `stateful_pvc_enabled = false`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés que vous avez fournis (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet (présent puisque Kavita utilise par défaut le type de charge de travail StatefulSet). |
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
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités
> autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la
> création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (par défaut) | Critique | Le désactiver déplace la base de données SQLite de Kavita sur un montage GCS FUSE, ce qui risque de corrompre le fichier SQLite/l'index de la bibliothèque lors d'écritures concurrentes. |
| `stateful_pvc_mount_path` | `/kavita/config` | Critique | Doit correspondre au répertoire de données fixe de Kavita ; le modifier sépare l'application de sa configuration/état SQLite. |
| `max_instance_count` | `1` | Critique | Kavita n'a pas de clustering ou de coordination d'écriture partagée ; plus d'un réplica contre le même PVC risque de corrompre SQLite. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Moyen | Le SSD utilise le quota `SSD_TOTAL_GB` serré ; sur un projet avec des contraintes de quota, passez au HDD (`standard`) car les besoins en E/S de Kavita ne nécessitent pas les IOPS du SSD. |
| `enable_nfs` | `false` | Faible | NFS est inutile — la persistance se fait via le PVC de bloc ; l'activer ajoute des coûts sans avantage pour la disposition par défaut de ce module. |
| `enable_redis` | `false` forcé dans `main.tf` | Faible | La définition de cette variable n'a aucun effet — Kavita n'utilise jamais Redis quelle que soit la valeur passée. |
| `stateful_fs_group` | `3000` | Élevé | Kavita s'exécute en tant qu'UID 1000/GID 2000 ; un `fsGroup` incorrect ou non défini peut rendre le PVC inaccessible en écriture par le conteneur au démarrage. |
| `memory_limit` | `1Gi` | Moyen | Confortable pour les grandes bibliothèques ; trop faible risque d'OOM lors des analyses de bibliothèque ou de l'indexation en texte intégral. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans le namespace. |
| Compte administrateur au premier démarrage | Terminez l'assistant de configuration rapidement après le déploiement | Moyen | Tant que l'assistant n'est pas exécuté, le service est accessible mais n'a pas de compte administrateur ni de bibliothèques configurées. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer entre les redéploiements, ce qui rompt le DNS et les URL OPDS mises en signet. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité ; Kavita n'a pas de chemin de sauvegarde de base de données séparé car son état est entièrement sur le PVC. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Kavita
partagée avec la variante Cloud Run est décrite dans
**[Kavita_Common](Kavita_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kavita sur GKE Autopilot](../labs/Kavita_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Kavita sur Google Cloud Run](Kavita_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Kavita Common — Configuration d'application partagée](Kavita_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Komga sur GKE Autopilot](Komga_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md), [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Bibliothèque numérique**.
