---
title: "UrBackup sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'UrBackup sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/UrBackup_GKE.md @ e69407af sha256:f479a6843804 -->

# UrBackup sur GKE Autopilot {#urbackup-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UrBackup_GKE.png" alt="UrBackup sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

UrBackup est un système de sauvegarde réseau client/serveur open-source pour
Windows, Linux et macOS, prenant en charge les sauvegardes au niveau des
fichiers et les sauvegardes complètes d'images disque avec déduplication côté
client (via des liens physiques) et une interface utilisateur de gestion web.
Ce module déploie le **serveur** UrBackup sur **GKE Autopilot** au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes. Les véritables agents
**clients** UrBackup s'exécutent sur les PC des utilisateurs — entièrement en
dehors de ce projet GCP — et se connectent à ce serveur selon leur propre
calendrier de sauvegarde.

**Il n'y a pas de `UrBackup_CloudRun`, et il n'y en aura pas.** Le protocole client
d'UrBackup nécessite trois ports TCP bruts (`55413` backend FastCGI, `55414`
interface utilisateur web directe, `55415` transfert client en mode internet)
plus la diffusion de découverte LAN UDP (`35622`-`35623`) accessibles
simultanément. L'entrée de Cloud Run (le GFE) est HTTP(S) à port unique
uniquement et ne peut pas exposer de TCP multi-ports bruts ou d'UDP du tout —
voir [UrBackup_Common](UrBackup_Common.md) pour la description complète ; il
s'agit de la même classe architecturale de lacune que les autres modules
**Common + GKE uniquement** de ce catalogue (Kopia, RocketChat, Immich,
Temporal, Prowlarr, VictoriaMetrics, Plausible, LobeChat, Supabase,
Woodpecker).

Ce guide se concentre sur les services cloud qu'UrBackup utilise et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et le cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

> **Ce module n'a pas été déployé sur un projet GCP en direct pendant le
> développement** (pas d'apply de cluster GKE), mais son image de conteneur
> personnalisée A ÉTÉ construite et exécutée localement avec `docker build` + `docker run`
> (un montage de liaison explicite à `/var/urbackup`, simulant un volume Kubernetes) —
> a confirmé que le serveur démarre réellement, initialise sa base de données
> et sert une véritable interface utilisateur web (`HTTP 200`, intitulée *"UrBackup
> - Keeps your data safe"*). Validez le chemin de la sonde de santé et la
> gestion des permissions PUID/PGID par rapport à un vrai cluster GKE avant
> de vous fier à cela en production.

---

## Ce que coûte UrBackup sur RAD, et comment cela se compare {#what-urbackup-costs-on-rad-and-how-that-compares}

**L'exécution d'UrBackup sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 42,08 US$/mois en frais Google Cloud** (environ 115,08 US$ si ce n'est pas votre seul cluster Autopilot), en plus d'un frais de module RAD unique de 75 crédits (7,50 US$) facturé une seule fois au moment du déploiement. Il n'existe pas de variante Cloud Run d'UrBackup — son protocole client nécessite un TCP multi-ports brut et une découverte LAN UDP que l'entrée HTTP(S) à port unique de Cloud Run ne peut pas exposer, donc GKE est la seule option. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (une seule fois) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 42,08 US$/mois, facturé par Google au prix catalogue | ~60 crédits/jour (environ 1800/mois, 180 US$ au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (add-ons, sauvegardes) | 1 US$ |
| **Total** | **42,08 US$** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- UrBackup n'a pas de version cloud hébergée officielle de son propre serveur — c'est un logiciel de sauvegarde réseau que vous pointez vers vos propres machines clientes, il n'y a donc pas de plan SaaS de fournisseur pour ce projet exact à comparer.
- Une comparaison avec un VPS autogéré, dimensionné pour les valeurs par défaut d'UrBackup de 1 vCPU / 1 GiB : un Hetzner CPX11 ou DigitalOcean 1 vCPU/2GB Droplet coûte environ 6-12 $/mois, moins cher en termes monétaires — plus votre propre temps pour les sauvegardes du serveur de sauvegarde, le patchage du système d'exploitation et le maintien de l'accessibilité des ports TCP bruts dont il a besoin, ce qu'un VPS nu transforme en votre propre problème de réseau.
- Les services commerciaux de sauvegarde cloud (Backblaze, outils d'instantanés des fournisseurs de cloud) sont un produit différent, pas une version hébergée d'UrBackup lui-même, ils ne sont donc pas nommés ici comme un concurrent — la comparaison honnête est l'auto-hébergement d'UrBackup par vous-même par rapport à la gestion du même logiciel par RAD pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) au total pour une chaîne
typique de 2-3 déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google dit que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il soit parti dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé UrBackup et que vous voulez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener UrBackup signifie redéployer à partir de
zéro. Cela coûte environ 78-81 crédits dans votre propre projet, ou environ
70,5-73,5 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si UrBackup devait rester inutilisé assez longtemps pour compenser
ce coût de redéploiement par rapport à son propre coût d'exécution — environ 6 jours ou plus dans votre propre projet
(environ 1,40 US$ par jour), ou environ 1 jour ou plus dans un projet géré par RAD
(60 crédits par jour).

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

UrBackup s'exécute comme un **pod unique**, soutenu par une revendication de
volume persistant de bloc GKE (pas Cloud SQL — UrBackup n'a pas de base de
données externe) :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Un pod exécute le serveur UrBackup, 1 vCPU / 1Gi par défaut |
| Base de données | Aucune (SQLite intégré) | Le serveur amorce sa propre base de données au premier démarrage |
| Stockage persistant | Volume persistant GKE (bloc, HDD `standard` StorageClass) | Contient À LA FOIS la base de données du serveur et toutes les données de sauvegarde client — voir §3 |
| Accès client | Un service `LoadBalancer` multi-ports dédié, provisionné directement par ce module | Couvre 55413/55414/55415 tcp + 35622-35623 udp — au-delà de ce que la ressource Service d'App_GKE peut exprimer |
| Secrets | Aucun | Le compte administrateur est créé via l'assistant de configuration de l'interface utilisateur web d'UrBackup lors du premier lancement |
| Entrée (interface utilisateur web uniquement) | Équilibrage de charge Cloud (facultatif, via Gateway) | Le service géré par la Fondation utilise par défaut `ClusterIP` — voir §6 |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Les données persistantes résident sur un seul PVC de bloc, monté à `/var/urbackup`,
  pas sur GCS.** L'image amont attend deux volumes distincts (`/var/urbackup` base de
  données, `/backups` données client) ; l'image personnalisée de ce module
  corrige le point d'entrée de l'image de base (au moment de la construction)
  pour rediriger les données de sauvegarde client vers un sous-répertoire
  `backups/` de `/var/urbackup` à la place, de sorte que les deux persistent sur le SEUL
  PVC que le StatefulSet de ce module prend en charge — vérifié localement :
  le point d'entrée corrigé démarre sur un serveur fonctionnel. `stateful_pvc_enabled = true` par
  défaut.
- **La classe de stockage est HDD (`standard`), pas SSD.** Les données de
  sauvegarde sont écrites séquentiellement et lues rarement ; le HDD utilise
  le quota `DISKS_TOTAL_GB` beaucoup plus grand au lieu du quota `SSD_TOTAL_GB` serré.
- **`stateful_pvc_size` nécessite une planification de capacité réelle.** La valeur par
  défaut de 200 Gi est un point de départ pour un petit pilote — dimensionnez-la
  pour votre flotte de clients réelle et votre politique de rétention.
- **`min_instance_count` est par défaut à 1, pas à l'échelle zéro.** Les clients réels se
  connectent selon leur propre calendrier non surveillé à des moments
  arbitraires ; un serveur mis à l'échelle zéro manquerait silencieusement les
  vérifications. `max_instance_count` est plafonné à 1 — SQLite intégré + déduplication par
  liens physiques ne prennent pas en charge les instances concurrentes.
- **Pas de secret d'amorçage administrateur.** La première visite du
  navigateur à l'interface utilisateur web présente l'assistant de
  configuration d'UrBackup pour créer le compte administrateur.
- **Un service multi-ports dédié est le véritable point d'entrée externe**,
  pas le service de la Fondation (qui utilise par défaut `ClusterIP`) — voir §6.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail UrBackup {#a-gke-autopilot--the-urbackup-workload}

Un seul pod exécute le serveur UrBackup (StatefulSet par défaut, puisque
`stateful_pvc_enabled = true` sélectionne automatiquement ce type de charge de travail).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail UrBackup pour voir le pod et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment fonctionnent la planification
Autopilot et Workload Identity.

### B. Stockage persistant — le PVC de bloc {#b-persistent-storage--the-block-pvc}

```bash
kubectl get pvc -n "$NAMESPACE"
kubectl describe pvc -n "$NAMESPACE" <pvc-name>
```

Confirmez que la StorageClass du PVC est HDD (`standard`) et que sa capacité
correspond à ce que vous avez configuré dans `stateful_pvc_size`. Il est monté à `/var/urbackup`
et contient À LA FOIS la base de données du serveur (directement) et toutes
les données de sauvegarde client (redirigées vers un sous-répertoire `backups/`
par un patch au moment de la construction du point d'entrée de l'image de base
— voir [UrBackup_Common](UrBackup_Common.md)).

### C. Le service d'accès client multi-ports dédié {#c-the-dedicated-multi-port-client-access-service}

```bash
kubectl get svc -n "$NAMESPACE" -o wide
kubectl describe svc -n "$NAMESPACE" <service-name>-client-ports
```

Ce service `LoadBalancer` (provisionné dans `urbackup.tf`, et non par la ressource Service
d'App_GKE) expose les cinq ports dont les clients UrBackup réels ont besoin :
`55413` (backend FastCGI), `55414` (interface utilisateur web), `55415`
(transfert client en mode internet, TCP), et `35622`-`35623` (découverte LAN,
UDP). Configurez les agents clients pour qu'ils se connectent à son IP externe
(sortie `urbackup_client_external_ip`).

### D. Réseau et entrée (interface utilisateur web uniquement) {#d-networking--ingress-web-ui-only}

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT"
```

`service_type` sur le service géré par la Fondation utilise par défaut `ClusterIP` — le
service multi-ports dédié ci-dessus est le seul point d'entrée externe dont
les clients réels ont besoin (il couvre également le port de l'interface
utilisateur web), il reste donc interne uniquement plutôt que de consommer une
deuxième IP externe. Il fonctionne toujours comme un backend d'API Gateway si
`enable_custom_domain` est défini pour un nom d'hôte convivial sur l'interface utilisateur
web.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application UrBackup {#3-urbackup-application-behaviour}

- **Un patch au moment de la construction redirige les données de sauvegarde
  vers le seul PVC monté.** L'image amont attend `/var/urbackup` (base de données
  SQLite du serveur) et `/backups` (données de sauvegarde client, liées par des
  liens physiques pour la déduplication entre les sauvegardes
  incrémentielles) comme volumes séparés. Comme un seul chemin de montage PVC
  est disponible, le Dockerfile de ce module corrige `sed` le point
  d'entrée de l'image de base afin qu'il écrive sa destination de données de
  sauvegarde (`/var/urbackup/backupfolder`) comme un sous-répertoire de `/var/urbackup` au lieu du chemin
  séparé `/backups` — vérifié localement (voir la note en haut de ce guide) : le
  point d'entrée corrigé démarre sur un serveur fonctionnel.
- **Pas de migration de base de données ou de job d'initialisation.** UrBackup
  amorce sa propre base de données SQLite au premier démarrage ; il n'y a pas
  d'étape de schéma gérée par Terraform.
- **Pas de credential administrateur injecté par l'environnement.** L'interface
  utilisateur web (port 55414) présente l'assistant de configuration d'UrBackup
  lors de la première visite pour créer le compte administrateur (confirmé en
  direct lors des tests locaux).
- **Les sondes de santé sont TCP, pas HTTP.** Les tests locaux ont confirmé
  que le chemin `/` de l'interface utilisateur web RENVOIE un véritable
  `HTTP 200` non authentifié — mais comme cette confirmation provenait d'un test
  Docker local plutôt que d'un déploiement GKE en direct, `startup_probe` et `liveness_probe`
  utilisent par défaut TCP contre le port d'écoute comme choix
  indépendant de la plateforme.
- **PUID/PGID/TZ contrôlent la propriété des fichiers.** Le point d'entrée de
  l'image de base change la propriété de `/var/urbackup` (le PVC monté) à l'uid/gid
  configuré avant de démarrer `urbackupsrv`.
- **Écriture unique, instance unique.** `max_instance_count` est plafonné à `1` — la base
  de données SQLite intégrée et la déduplication basée sur les liens physiques
  ne prennent pas en charge les instances de serveur concurrentes sur les mêmes
  données.
- **Le service multi-ports personnalisé dépend du module Fondation.** Il utilise
  son propre bloc `provider "kubernetes" {}` (`provider-auth.tf`) car un module parent ne peut pas accéder à
  la propre configuration de fournisseur interne de `App_GKE` — le même modèle
  déjà établi pour les ressources RBAC de `Woodpecker_GKE`. Son sélecteur de pod est
  calculé à partir de l'appel `module.deployment_id` de ce module (déterministe, garanti de
  correspondre à ce que le StatefulSet d'App_GKE applique à ses pods), non
  deviné ou codé en dur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
UrBackup sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par
défaut. Voir `modules/UrBackup_GKE/README.md` pour la référence exhaustive des entrées, groupe par
groupe.

### Groupe 1–2 — Projet et identité {#group-12--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `urbackup` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Se résout en interne en un `2.5.x` épinglé. |
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Limite CPU pour le conteneur UrBackup. |
| `memory_limit` | `1Gi` | Limite de mémoire pour le conteneur UrBackup. |
| `min_instance_count` | `1` | PAS de mise à l'échelle à zéro — voir §1. |
| `max_instance_count` | `1` | Plafonné en pratique. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Pour le service géré par la Fondation UNIQUEMENT (port unique 55414) — voir §2D. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` depuis `stateful_pvc_enabled = true`. |
| `namespace_name` | `""` (auto) | Généré automatiquement à partir de `application_name` + `tenant_id`. |

### Groupe 7 — StatefulSet / Stockage persistant {#group-7--statefulset--persistent-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Requis en pratique — voir §1/§3. |
| `stateful_pvc_size` | `200Gi` | **Planifiez la capacité pour votre flotte de clients réelle + la rétention.** |
| `stateful_pvc_mount_path` | `/var/urbackup` | Doit rester `/var/urbackup` — le répertoire de base de données du serveur ; le patch de construction de l'image personnalisée dépend de ce chemin exact pour rediriger également les données de sauvegarde. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Les données de sauvegarde n'ont pas besoin d'IOPS SSD. |
| `stateful_fs_group` | `0` (non défini) | Le point d'entrée d'exécution racine du conteneur gère déjà la propriété. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | TCP, port 55414 | Voir §3 — non confirmé comme un point de terminaison HTTP sûr. |
| `uptime_check_config` | désactivé | Si activé, nécessiterait un chemin accessible sur le service de la Fondation. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | UrBackup n'en a pas besoin — pas de schéma à créer. |
| `cron_jobs` | `[]` | CronJobs Kubernetes. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage_volume` | `false` | Bucket de secours facultatif, PAS le stockage principal d'UrBackup (c'est le PVC de bloc). |

### Groupe 16-17 — Base de données, sauvegarde et maintenance {#group-16-17--database-backup--maintenance}

Non applicable — UrBackup n'a pas de base de données SQL. Toutes les variables
liées à la base de données sont des miroirs inertes conservés pour la
convention de mise en miroir des variables de la Fondation.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle pour l'interface utilisateur web sur un nom d'hôte convivial (facultatif). |
| `reserve_static_ip` | `true` | Pour le chemin OPTIONNEL de la passerelle/domaine personnalisé uniquement — pas le service multi-ports côté client. |

### Groupe 23 — Accès réseau client de sauvegarde {#group-23--backup-client-network-access}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `urbackup_puid` / `urbackup_pgid` | `1000` / `1000` | Transféré au comportement chown PUID/PGID de l'image de base. |
| `urbackup_timezone` | `Etc/UTC` | Affecte la planification/les horodatages des sauvegardes. |
| `urbackup_static_ip_address` | `""` (éphémère) | Apportez votre propre IP statique pré-réservée pour le service multi-ports dédié — ce module n'en réserve pas automatiquement. |

### Groupes 8, 9, 12, 18, 20, 21, 22 {#groups-8-9-12-18-20-21-22}

Comportement standard de `App_GKE` — Quota de ressources, Politiques de
fiabilité, CI/CD et autorisation binaire, SQL personnalisé (non applicable),
IAP, Redis (non applicable — UrBackup n'utilise pas de cache) et Cloud Armor,
VPC Service Controls. Voir [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `namespace` / `service_cluster_ip` / `service_external_ip` / `service_url` | Détails du service géré par la Fondation (interne — `ClusterIP` par défaut). |
| `urbackup_client_service_name` | Nom du service multi-ports dédié auquel les clients réels se connectent. |
| `urbackup_client_external_ip` | IP externe du service multi-ports dédié — configurez les clients pour qu'ils se connectent à celle-ci. |
| `urbackup_client_ports` | La carte de ports fixe (55413/55414/55415 tcp, 35622-35623 udp). |
| `storage_buckets` | Le bucket GCS de secours facultatif (démonté par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs et les combinaisons au moment de la planification. Le propre
> `UrBackup_GKE` de `validation.tf` rejette en outre `min_instance_count > max_instance_count` et `enable_iap = true` sans les deux
> identifiants OAuth.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_size` | Planifiez la capacité pour votre flotte de clients réelle + la politique de rétention | **Critique** | Un sous-dimensionnement signifie que les sauvegardes client commenceront à échouer avec "disque plein" une fois que le PVC sera rempli — il s'agit d'une application à grandes données, pas d'une petite configuration ; la valeur par défaut de 200 Gi est un point de départ pour un petit pilote uniquement. |
| `stateful_pvc_mount_path` | Laisser à `/var/urbackup` | **Critique** | Le patch de point d'entrée de l'image personnalisée au moment de la construction redirige les données de sauvegarde vers un sous-répertoire de ce chemin exact ; le modifier sans modifier également le Dockerfile rompt entièrement la disposition de la base de données/des données de sauvegarde. |
| `stateful_pvc_storage_class` | Laisser à `standard` (HDD) sauf si vous avez un besoin spécifique en IOPS élevé | **Moyen** | Le SSD (`standard-rwo`/`premium-rwo`) utilise le quota `SSD_TOTAL_GB` serré (aussi peu que 500 Go sur certains projets contraints) — un grand PVC de capacité de sauvegarde sur SSD peut épuiser ce quota rapidement sans réel avantage de performance (les écritures de sauvegarde sont séquentielles, non limitées par les IOPS). |
| Connectivité client | Pointer les agents clients vers `urbackup_client_external_ip`, jamais `service_url`/`service_external_ip` | **Élevé** | Ces dernières sorties suivent le service de la Fondation interne uniquement (port de l'interface utilisateur web uniquement) ; les clients qui y sont dirigés ne peuvent pas terminer le protocole de transfert de données de sauvegarde réel. |
| `min_instance_count` | Laisser à `1` | **Élevé** | La mise à l'échelle à zéro signifie que le serveur peut ne pas fonctionner lorsqu'une tentative de sauvegarde non surveillée et arbitrairement planifiée d'un client arrive — sauvegardes manquées silencieusement, pas une erreur visible. |
| `max_instance_count` | Laisser à `1` | **Critique** | La base de données SQLite intégrée et la déduplication basée sur les liens physiques n'ont pas de coordination multi-instances ; les serveurs concurrents corrompraient ou se feraient concurrence sur l'état de l'autre. |
| Sondes de santé | Laisser en TCP (par défaut du module) | **Moyen** | Non confirmé si un chemin HTTP sur l'interface utilisateur web est sécurisé non authentifié pour cette image — une sonde HTTP incorrecte pourrait bloquer le déploiement si l'hypothèse est fausse. |
| `urbackup_static_ip_address` | Laisser vide sauf si vous avez pré-réservé une adresse | **Faible** | Ce module ne provisionne pas automatiquement une réservation (pour éviter d'épuiser silencieusement un quota d'IP statiques rares à l'échelle du projet) — définir cela sur une adresse que vous n'avez pas réellement réservée fait échouer l'apply. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à UrBackup
est décrite dans **[UrBackup_Common](UrBackup_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : UrBackup sur GKE Autopilot](../labs/UrBackup_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [UrBackup Common — Configuration d'application partagée](UrBackup_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Kopia sur GKE Autopilot](Kopia_GKE.md), [Filebrowser sur GKE Autopilot](Filebrowser_GKE.md) dans la solution **Sauvegarde et reprise après sinistre**.
