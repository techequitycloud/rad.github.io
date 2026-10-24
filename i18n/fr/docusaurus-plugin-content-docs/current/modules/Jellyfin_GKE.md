---
title: "Jellyfin sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Jellyfin sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Jellyfin_GKE.md @ e69407af sha256:f45d032224de -->

# Jellyfin sur GKE Autopilot {#jellyfin-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellyfin_GKE.png" alt="Jellyfin sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Jellyfin est un serveur multimédia auto-hébergé gratuit et open source (GPLv2)
pour diffuser vos propres films, émissions de télévision, musique, photos et
télévision en direct. Écrit en .NET/C# et maintenu comme un fork communautaire
d'Emby, il n'a pas de suivi, pas de publicité et pas de niveau premium. Ce
module déploie Jellyfin sur **GKE Autopilot** au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Jellyfin et sur la
façon de les explorer et de les utiliser à partir de la console Google Cloud et
de la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Jellyfin sur RAD, et comment cela se compare {#what-jellyfin-costs-on-rad-and-how-that-compares}

**Jellyfin sur le module GKE de RAD coûte environ 42 $ US par mois dans votre
propre projet, plus des frais de module de 75 crédits (7,50 $ US) une fois par
déploiement.** Si vous n'en avez besoin qu'une partie de l'année, consultez
« Mettez-le en pause gratuitement » ci-dessous pour arrêter de payer sans
perdre votre médiathèque. Jellyfin est également livré en tant que module Cloud
Run, qui est l'option la moins chère ici (environ 33 $ US/mois) — consultez le
guide Cloud Run, sauf si vous utilisez déjà GKE Autopilot pour d'autres
applications.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42,08 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde d'achat minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas de deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1,
prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 42,08 $ US** |

### Comment cela se compare {#how-it-compares}

- Le propre projet de Jellyfin n'exécute aucun SaaS hébergé et n'a pas
  l'intention de le faire — il est explicitement conçu comme l'alternative
  gratuite et sans suivi aux produits de serveur multimédia payants, il n'y a
  donc pas de "Jellyfin Cloud" à comparer.
- L'empreinte de Jellyfin (1 vCPU, 1 GiB) est légère ; un Hetzner CPX22 ou un
  droplet DigitalOcean 2 vCPU/4 Go (environ 24 $/mois) est plus que suffisant,
  et un GCP Compute Engine e2-standard-2 (environ 49 $/mois) est
  confortablement surdimensionné — mais vous devez alors gérer le système
  d'exploitation, le stockage et les correctifs de sécurité vous-même.
- Ce que RAD ajoute par rapport à un VPS nu ici est principalement le partage
  NFS pour votre médiathèque et la gestion du réseau et de la surveillance ;
  Jellyfin lui-même n'a pas besoin de base de données, il n'y a donc pas
  d'administration de base de données à décharger.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Jellyfin s'exécute dans un projet géré par RAD pour vous et que vous
prévoyez d'y revenir — une pause entre les cours, une accalmie saisonnière, ou
simplement ne pas savoir encore si vous en aurez besoin le mois prochain —
c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
demande à Google de supprimer purement et simplement le projet : la suppression
logique récupérable de 30 jours de Google. Contrairement à la suppression de
Jellyfin en tant que module unique, cela ne supprime pas le service Cloud
Run/GKE, le serveur de fichiers NFS et le réseau un par un — l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Parce que rien n'a été
détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes — c'est une vérification, pas une reconstruction, et une mise à jour
ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée
de crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements
typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours
— après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, de sorte que votre solde de
crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le
niveau sandbox que la plupart utilisent conviennent). Google indique que la
plupart des services fonctionnent à nouveau pleinement dans les 36 heures
suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il soit parti dès que
vous supprimez le projet, même si le projet lui-même est récupérable pendant 30
jours. L'exportation nocturne de Jellyfin couvre sa configuration, pas vos
fichiers multimédias, qui se trouvent sur le partage NFS et ne sont pas
détruits individuellement par ce chemin — mais copiez tout ce qui est
irremplaçable avant de tout supprimer.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est
passée, la solution de repli est de supprimer Jellyfin purement et simplement
et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les
  builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de
  temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de
  l'argent que si Jellyfin devait rester inutilisé pendant environ 6 jours ou
  plus dans votre propre projet (environ 1 jour ou plus dans un projet géré par
  RAD). La majeure partie du coût de fonctionnement ici est le coût de gestion
  du cluster GKE, donc la suppression de Jellyfin seule n'économise que la part
  de son propre pod si d'autres applications partagent le cluster.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites
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
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
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

Jellyfin s'exécute comme une charge de travail .NET avec état. Sur GKE, c'est
l'**emplacement recommandé pour une véritable médiathèque** : un StatefulSet
soutenu par un véritable **PVC de bloc** à `/config` offre une sémantique de
système de fichiers POSIX correcte pour SQLite et le cache de transcodage. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod StatefulSet .NET, 1 vCPU / 1 GiB par défaut |
| Persistance | Persistent Disk (PVC de bloc) | `/config` sur un PVC par pod — le stockage recommandé pour SQLite + cache de transcodage |
| Base de données | SQLite interne (embarqué) | Pas de Cloud SQL — Jellyfin conserve tout l'état dans des fichiers SQLite sous `/config` |
| Stockage d'objets / de fichiers | Cloud Storage (GCS FUSE) / Filestore (NFS) | Facultatif, pour les grandes médiathèques |
| Secrets | Secret Manager | Clé API auto-générée facultative ; pas de secrets cryptographiques obligatoires |
| Ingress | Cloud Load Balancing | ClusterIP par défaut ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Jellyfin stocke tout son état —
  la bibliothèque SQLite et les bases de données de lecture, le XML de
  configuration, les métadonnées et illustrations mises en cache, les plugins,
  le cache de transcodage et les journaux — sous `/config`. Aucune instance Cloud
  SQL, aucun job `db-init` et aucun Redis n'est utilisé (`database_type = NONE` ; les
  variables Redis de la fondation sont inertes pour Jellyfin).
- **Un PVC de bloc à `/config` est la valeur par défaut.** `stateful_pvc_enabled = true` (la
  valeur par défaut) résout la charge de travail en un **StatefulSet** avec un
  PVC par pod monté à `/config`, et le volume de stockage GCS se désactive
  automatiquement pour éviter un double montage. Le stockage de bloc réel
  fournit la sémantique de système de fichiers correcte dont SQLite et le cache
  de transcodage ont besoin — la configuration recommandée pour un serveur
  multimédia.
- **Le conteneur écoute sur le port 8096.** Le port web/API de Jellyfin est
  défini par Jellyfin_Common. L'interface utilisateur web et l'assistant de
  configuration de première exécution sont servis à `/web` (et `/`) ;
  `GET /health` renvoie `Healthy` (200, non authentifié).
- **Il n'y a pas d'identifiants par défaut.** Lors du premier accès, l'assistant
  de configuration crée le compte administrateur et ajoute des médiathèques.
  Rien n'est utilisable avant cela.
- **Réplica unique.** `min_instance_count = 1` / `max_instance_count = 1` — une bibliothèque SQLite
  partagée sur un volume. **Ne pas exécuter plusieurs réplicas** ; les
  écritures concurrentes sur un seul fichier SQLite corrompent la
  bibliothèque.
- **NFS est facultatif, pour les grandes bibliothèques.** `enable_nfs = false` par défaut.
  Activez-le pour monter un volume Filestore partagé pour une grande collection
  multimédia qui dépasse la taille d'un seul PVC.
- **L'authentification par clé API est facultative et désactivée par défaut.**
  `enable_api_key = false`. L'authentification principale est le compte administrateur créé par
  l'assistant ; les clés API par application sont créées dans l'application
  sous **Tableau de bord → Clés API**.

> **GKE vs Cloud Run — GKE est le serveur multimédia de production.**
> **GKE (ce module)** exécute Jellyfin en tant que StatefulSet avec un véritable
> **PVC de bloc** à `/config`, offrant une véritable sémantique POSIX pour SQLite
> et le cache de transcodage, plus un **NFS** facultatif pour les grandes
> médiathèques — le choix recommandé pour un véritable serveur multimédia
> multi-utilisateurs et de transcodage. **[Jellyfin_CloudRun](Jellyfin_CloudRun.md)**
> monte `/config` à partir du volume NFS partagé ; il est plus simple et moins cher
> pour une démo ou une petite bibliothèque personnelle, mais la latence du
> stockage réseau et le modèle de délai d'attente par requête le rendent peu
> adapté au transcodage en direct ou au streaming intensif.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Jellyfin {#a-gke-autopilot--the-jellyfin-workload}

Les pods Jellyfin sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Avec un PVC de bloc, la charge de travail est
un StatefulSet avec une identité de pod stable et des redémarrages ordonnés.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Jellyfin pour voir les pods, les événements et le StatefulSet.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe (lorsqu'elle
  est exposée).
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et
le type de charge de travail (Déploiement vs StatefulSet) sont gérés.

### B. Stockage de configuration persistant (SQLite sur le PVC) {#b-persistent-configuration-store-sqlite-on-the-pvc}

Jellyfin n'a **pas de base de données externe**. Tout son état — la
bibliothèque SQLite et les bases de données de lecture, le XML de
configuration, les métadonnées et illustrations mises en cache, les plugins
installés, le cache de transcodage et les journaux — se trouve sous `/config`
(`JELLYFIN_CONFIG_DIR = /config`). Il n'y a pas d'instance Cloud SQL, pas de proxy d'authentification
et pas de job d'initialisation pour créer un schéma ; Jellyfin crée et migre
ses propres bases de données SQLite au premier démarrage.

Sur GKE, `/config` est soutenu par un **PVC de bloc** par pod (`stateful_pvc_enabled = true`, monté
à `/config`), qui est le stockage recommandé car SQLite et le cache de
transcodage ont besoin d'une sémantique de système de fichiers POSIX réelle que
le stockage d'objets ne peut pas fournir.

- **Inspecter le PVC et son disque lié :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

### C. Cloud Storage et NFS (facultatif, pour les grandes bibliothèques) {#c-cloud-storage--nfs-optional-for-large-libraries}

Le bucket **Cloud Storage** auto-provisionné (suffixe de nom `storage`, `STANDARD`,
`force_destroy = true`, versioning désactivé, `public_access_prevention = enforced`) est disponible pour des montages
GCS FUSE supplémentaires. Lorsqu'un PVC de bloc est activé, le volume de
stockage GCS est automatiquement désactivé pour `/config` afin d'éviter un
double montage. Pour les grandes collections multimédias, activez **NFS**
(`enable_nfs = true`) pour monter un volume Filestore partagé.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et le pilote CSI GCS FUSE.

### D. Configuration de première exécution et médiathèque {#d-first-run-setup--the-media-library}

Lors du premier accès, Jellyfin sert un **assistant de configuration**
interactif à `/web` (et `/`) qui crée le compte administrateur, définit la
langue préférée et vous permet d'ajouter des médiathèques (Films, TV, Musique,
Photos). Rien n'est authentifié ou utilisable tant que vous n'avez pas terminé
l'assistant — il n'y a pas d'identifiants par défaut.

Les médiathèques pointent vers des chemins à l'intérieur du conteneur : le PVC
de bloc à `/config`, un montage NFS facultatif pour les grandes collections, ou des
volumes GCS FUSE supplémentaires.

- **Atteindre l'assistant / l'interface utilisateur web :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"      # external IP / hostname
  kubectl port-forward -n "$NAMESPACE" statefulset/<service-name> 8096:8096
  # then open http://localhost:8096/web
  ```

### E. Secret Manager et la clé API facultative {#e-secret-manager--the-optional-api-key}

Jellyfin ne nécessite **aucun secret cryptographique obligatoire** — il n'y a
pas de clé de chiffrement, de JWT ou de mot de passe maître à gérer. Lorsque
`enable_api_key = true`, le module génère une valeur aléatoire de 32 caractères et la stocke
dans Secret Manager sous `secret-<prefix>-<app>-api-key` (affichée comme la sortie `jellyfin_api_key_secret_id`). **Bug
connu :** la valeur est livrée via `explicit_secret_values` sous la clé `QDRANT__SERVICE__API_KEY` — le propre
commentaire `main.tf` du module le documente même comme "la convention de
configuration imbriquée `__` de Jellyfin", mais Jellyfin n'a pas une telle
convention ; c'est un reste de copier-coller hérité de Qdrant_GKE. Rien dans le
conteneur Jellyfin ne lit cette variable d'environnement (ou toute autre) pour
l'authentification par clé API, donc aujourd'hui `enable_api_key = true` ne matérialise qu'un
secret Kubernetes inutilisé — il ne permet **pas** aux appelants externes de
s'authentifier. La seule façon d'obtenir une clé API utilisable est dans
l'application sous **Tableau de bord → Clés API** ; l'authentification
principale reste le compte administrateur de l'assistant.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut `service_type = ClusterIP`, le serveur multimédia reste dans le cluster. Définissez
`service_type = LoadBalancer` pour une adresse IP externe, ou activez un domaine personnalisé avec un
certificat géré par Google via l'API Kubernetes Gateway. Une adresse IP statique
peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Jellyfin {#3-jellyfin-application-behaviour}

- **Pas de job d'initialisation.** Jellyfin n'a pas besoin d'étape `db-init` — il
  crée et migre ses propres bases de données SQLite sous `/config` la première
  fois qu'il démarre. Laissez `initialization_jobs` vide, sauf si vous avez des tâches de
  chargement de données personnalisées.
- **L'assistant de première exécution crée l'administrateur.** L'assistant de
  configuration `/web` vous guide dans la création du compte administrateur et
  l'ajout de bibliothèques. Tant qu'il n'est pas terminé, le serveur n'a pas
  d'utilisateurs ni de contenu.
- **`/config` est la seule source de vérité — persistez-le.** Tout l'état de la
  bibliothèque se trouve sur le PVC de bloc. La suppression du PVC efface la
  bibliothèque, les plugins et les utilisateurs. Le StatefulSet maintient le
  PVC lié à l'identité du pod lors des redémarrages.
- **L'image personnalisée est un wrapper léger.** Le Dockerfile est
  `ARG JELLYFIN_VERSION=10.10.3` / `FROM jellyfin/jellyfin:${JELLYFIN_VERSION}`, de sorte que la Fondation le met en miroir dans Artifact
  Registry (`enable_image_mirroring = true`) et définit `imagePullPolicy = Always` pour l'image mise en miroir.
  `application_version = "latest"` se résout en `10.10.3` épinglé via l'argument de build
  `JELLYFIN_VERSION` spécifique à l'application — il n'est **pas** écrasé par
  l'injection générique `APP_VERSION` de la Fondation.
- **fsGroup pour un PVC inscriptible par le groupe.** Jellyfin s'exécute en
  tant que UID 1000 / GID 2000 ; `stateful_fs_group = 3000` (la valeur par défaut du graphique Helm
  Jellyfin) garantit que le PVC est inscriptible par le groupe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /health`, qui renvoie `Healthy` (200) sans authentification une fois le serveur
  prêt. La sonde de démarrage permet un délai initial de 15 secondes avec une
  fenêtre de nouvelle tentative généreuse ; la sonde de vivacité interroge
  toutes les 30 secondes.
- **Le transcodage est gourmand en CPU et sans GPU.** Les pods Autopilot n'ont
  pas de GPU, il faut donc privilégier les clients de lecture directe.
  Augmentez `cpu_limit` pour le transcodage en direct et `memory_limit` pour les grandes
  bibliothèques.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Jellyfin sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `jellyfin` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Jellyfin Media Server` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tag de l'image Jellyfin ; `latest` épingle à `10.10.3` via l'argument de build `JELLYFIN_VERSION`. |
| `enable_api_key` | `false` | Générer une clé API aléatoire dans Secret Manager. Recommandé lorsque l'accès est possible en dehors de l'espace de noms. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; augmenter pour le transcodage en direct. |
| `memory_limit` | `1Gi` | Mémoire par pod ; augmenter pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Réplicas minimum ; maintenir à 1 (bibliothèque partagée unique). |
| `max_instance_count` | `1` | **Maintenir à 1.** Une bibliothèque SQLite partagée sur un volume — ne jamais exécuter plusieurs réplicas. |
| `container_port` | `8096` | Port web/API de Jellyfin (défini par Jellyfin_Common ; non transféré à App_GKE). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Jellyfin n'a pas de Cloud SQL — laisser `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir `jellyfin/jellyfin` dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | VPA optimise les requêtes ; désactive HPA lorsqu'il est activé. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires pour le conteneur Jellyfin. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé ; `LoadBalancer` pour l'accès externe. |
| `workload_type` | `null` → `StatefulSet` | Se résout en StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Mode d'affinité de session pour le service. |
| `namespace_name` | `""` | Auto-généré à partir de `application_name` + `tenant_id` si vide. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes après SIGTERM avant SIGKILL — permet de vider les écritures en cours. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Activer le modèle PVC. **Recommandé `true` pour Jellyfin** — se résout automatiquement en StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; taille pour contenir `/config` (SQLite, métadonnées, cache de transcodage). |
| `stateful_pvc_mount_path` | `/config` | Chemin de montage du conteneur pour le PVC (répertoire de configuration/persistance de Jellyfin). |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, qui maintient le volume hors du quota strict `SSD_TOTAL_GB` ; utiliser `standard-rwo` (PD équilibré, SSD) ou `premium-rwo` pour des IOPS plus élevées — voir le tableau des pièges ci-dessous. |
| `stateful_headless_service` | `null` | Service sans tête pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Redémarrages ordonnés sécurisés pour Jellyfin. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | Stratégie de mise à jour. |
| `stateful_fs_group` | `3000` | fsGroup du pod pour que le PVC soit inscriptible par le groupe (Jellyfin UID 1000 / GID 2000). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota` (`false`) plus `quota_cpu_requests` / `quota_cpu_limits` /
`quota_memory_requests` / `quota_memory_limits` / `quota_max_pods` /
`quota_max_services` / `quota_max_pvcs` — Quota de ressources de l'espace de noms. Les valeurs de
quota `*_requests` / `*_limits` ne sont **pas transférées** dans ce module et sont
inertes ; les valeurs de mémoire, si elles sont utilisées ailleurs, doivent
porter des suffixes d'unité binaire (`4Gi`, `8192Mi`).

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s de délai | Sonde de démarrage ; `/health` renvoie 200 une fois prêt. |
| `liveness_probe` | HTTP `/health` 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage de l'infrastructure au niveau App_GKE. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité au niveau App_GKE. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jellyfin n'a pas besoin de job d'initialisation ; fournir uniquement pour les tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, tâches de maintenance). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Jellyfin. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionner Cloud Filestore (NFS) ; activer pour les grandes médiathèques partagées. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket Jellyfin `storage` et tout supplément. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS FUSE supplémentaires via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

`database_type` (`NONE`), `database_password_length`, `application_database_name`
(`jellyfindb`), `application_database_user` (`jellyfinuser`), `enable_mysql_plugins`,
`enable_postgres_extensions`, `db_*` / `db_*_env_var_name` — **tous inertes pour
Jellyfin** (pas de base de données SQL) ; conservés et transférés pour la
compatibilité de la fondation.

### Groupe 15 — Redis (transféré pour la compatibilité de la fondation) {#group-15--redis-forwarded-for-foundation-compatibility}

`enable_redis`, `redis_host`, `redis_port`, `redis_auth` — **non applicable à
Jellyfin**, qui n'utilise pas de cache ou de file d'attente. Transféré à la
fondation uniquement pour la compatibilité ; laisser les valeurs par défaut.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC) du volume `/config`. |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un instantané `/config` lors du déploiement (valeur par défaut `tar`). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable lors des redéploiements. |
| `static_ip_name` | `""` | Auto-généré si vide. |

### Groupe 20 — Proxy compatible avec l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** L'activation d'IAP nécessite une authentification par
> identité Google pour **toutes** les requêtes entrantes. Nécessite que
> `enable_custom_domain` ou `enable_cdn` soit vrai.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Jellyfin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode de simulation. |
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
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Jellyfin. |
| `jellyfin_api_key_secret_id` | ID du secret Secret Manager pour la clé API (vide lorsque `enable_api_key = false`). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour un déploiement Jellyfin par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — une charge de travail `Deployment` à côté de `stateful_pvc_enabled = true`, IAP sans identités autorisées, `quota_memory_*` sans suffixes d'unité binaire, un `timeout_seconds`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC `/config` | Ne jamais supprimer | Critique | Le PVC contient la bibliothèque SQLite, les utilisateurs et les métadonnées ; sa suppression efface l'intégralité du serveur. |
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC persistant, `/config` est éphémère et la bibliothèque est perdue à chaque redémarrage du pod. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans une seule bibliothèque SQLite et la corrompent. |
| `workload_type` vs `stateful_pvc_enabled` | Laisser `workload_type` non défini | Critique | `Deployment` + `stateful_pvc_enabled = true` échoue au moment de la planification ; laisser non défini pour une résolution automatique en StatefulSet. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `stateful_pvc_size` | Adapter à la bibliothèque | Élevé | Un PVC sous-dimensionné se remplit pendant la mise en cache des métadonnées/transcodage et bloque le serveur. |
| `stateful_fs_group` | `3000` | Élevé | Un mauvais fsGroup rend le PVC non inscriptible par Jellyfin (UID 1000 / GID 2000) — le démarrage échoue. |
| `memory_limit` | `1Gi` (augmenter pour les grandes bibliothèques) | Élevé | Trop peu de mémoire tue le pod par manque de mémoire vive (OOM-kill) lors de la numérisation ou du transcodage d'une grande bibliothèque. |
| `cpu_limit` | `1000m` (augmenter pour le transcodage) | Élevé | Le transcodage en direct (sans GPU) sature le CPU ; préférer les clients de lecture directe. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_api_key` | Laisser `false` ; non fonctionnel actuellement | Moyen | Le secret généré est livré sous forme de `QDRANT__SERVICE__API_KEY` (un reste de copier-coller de Qdrant_GKE) — Jellyfin ne le lit jamais, il ne matérialise donc qu'un Secret Kubernetes inutilisé. Créez plutôt des clés API dans l'application sous Tableau de bord → Clés API. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser le pod unique pendant la maintenance, interrompant les flux. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour récupérer un instantané de bibliothèque plus ancien. |
| `stateful_pvc_storage_class` | `standard` (HDD, la valeur par défaut) | Moyen | Jellyfin est une application média/SQLite — les `standard-rwo` basés sur SSD consomment le quota régional strict de `SSD_TOTAL_GB`, et la mise à l'échelle à zéro NE libère PAS le PVC. Gardez le HDD sauf si vous avez besoin des IOPS du SSD. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Jellyfin partagée avec
la variante Cloud Run est décrite dans **[Jellyfin_Common](Jellyfin_Common.md)**. Pour
un guide pas à pas, voir le [lab Jellyfin_GKE](../labs/Jellyfin_GKE.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jellyfin sur GKE Autopilot](../labs/Jellyfin_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Jellyfin sur Google Cloud Run](Jellyfin_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Jellyfin Common — Configuration d'application partagée](Jellyfin_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md), [Jellystat sur GKE Autopilot](Jellystat_GKE.md), [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Serveur Média**.
