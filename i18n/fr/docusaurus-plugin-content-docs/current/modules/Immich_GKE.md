---
title: "Immich sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Immich sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Immich_GKE.md @ e69407af sha256:be8633db9ee8 -->

# Immich sur GKE Autopilot {#immich-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Immich_GKE.png" alt="Immich sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Immich est une plateforme open source de gestion de photos et de vidéos auto-hébergée sous licence AGPL-3.0 — une alternative à Google Photos avec sauvegarde automatique mobile, une chronologie, des albums, le partage, la recherche intelligente basée sur CLIP et la reconnaissance faciale. Toutes les fonctionnalités sont gratuites : la clé de produit optionnelle à 99 $ est un badge de soutien uniquement, sans aucune restriction de fonctionnalités. Ce module déploie Immich sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Il n'y a délibérément **aucune variante CloudRun** de ce module. La médiathèque d'Immich est un système de fichiers local — elle n'a pas de backend de stockage S3/GCS — et les téléchargements de photos/vidéos sont régulièrement de plusieurs Go, ce qui ne correspond pas au modèle de requête de Cloud Run.

Ce guide se concentre sur les services cloud qu'Immich utilise et sur la façon de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md).

---

## Ce que coûte Immich sur RAD et comment cela se compare {#what-immich-costs-on-rad-and-how-that-compares}

**Immich sur le module GKE de RAD coûte environ 150 $ US par mois dans votre propre projet, plus des frais de module de 300 crédits (30 $ US) une fois par déploiement — avec toutes les fonctionnalités débloquées, y compris la reconnaissance faciale et la recherche CLIP (la clé de produit Immich optionnelle à 99 $ est un badge de soutien uniquement).** Si vous n'en avez besoin qu'occasionnellement, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre votre bibliothèque de photos. Immich n'est livré que sous forme de module GKE sur RAD ; il n'y a pas de variante Cloud Run.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30,00 $ US) | 270 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **149,81 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **116 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US lors d'une recharge ponctuelle, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 Gio | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 149,81 $ US** |

### Comment cela se compare {#how-it-compares}

- Immich lui-même ne propose pas de SaaS hébergé officiel — ses mainteneurs sont explicites sur le fait que l'auto-hébergement est le but — donc la comparaison honnête se fait avec les services qu'il remplace. Le stockage payant de Google Photos (Google One) commence à 1,99 $/mois pour 100 Go et 2,99 $/mois pour 200 Go, mais une bibliothèque de photos familiale partagée avec des vidéos dépasse rapidement cela, et vous renoncez au contrôle de l'auto-étiquetage et à la propriété des originaux en échange.
- L'empreinte d'Immich (2 vCPU, 4 Gio, plus une base de données et une VM NFS) est proche d'un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (environ 24 $/mois) ou d'une GCP Compute Engine e2-standard-2 (environ 49 $/mois) — moins cher en espèces, mais vous devez alors gérer PostgreSQL, le partage NFS, les sauvegardes, les correctifs de sécurité et les mises à niveau du conteneur d'apprentissage automatique vous-même.
- Ce que RAD ajoute par rapport à un VPS nu : Cloud SQL géré avec sauvegardes automatisées et récupération ponctuelle, Secret Manager pour les identifiants et la surveillance — les éléments qui transforment un projet d'auto-hébergement de week-end en quelque chose que vous pouvez laisser fonctionner sans surveillance.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Immich s'exécute dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause entre les cours, un creux saisonnier, ou simplement ne pas savoir si vous en aurez besoin le mois prochain — c'est la meilleure option, et elle ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet : la suppression douce récupérable de 30 jours de Google. Contrairement à la suppression d'Immich en tant que module unique, cela ne supprime pas le pod GKE, la base de données Cloud SQL, le serveur de fichiers NFS et le réseau un par un — l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart utilisent conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression douce de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. L'exportation nocturne de la base de données et des métadonnées de la bibliothèque d'Immich est conservée dans ce bucket ; les photos et vidéos originales se trouvent dans le stockage attaché du pod GKE et le partage NFS, qui ne sont pas détruits individuellement par ce chemin, de sorte que votre bibliothèque elle-même survit les 30 jours intacte — c'est spécifiquement la copie de sauvegarde des métadonnées/base de données qui n'est pas récupérable à partir du bucket d'un projet supprimé.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli consiste à supprimer Immich purement et simplement et à le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression ne permet d'économiser de l'argent que si Immich resterait autrement inutilisé pendant environ 6 jours ou plus dans votre propre projet (environ 2 jours ou plus dans un projet géré par RAD). La base de données et le serveur de fichiers NFS d'Immich représentent la majeure partie du coût de fonctionnement ici, donc si rien d'autre dans le projet ne les partage, la suppression d'Immich supprime toute la facture ci-dessus.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

Immich s'exécute en tant que **deux services** : le serveur Immich (API + workers d'arrière-plan in-process, image personnalisée) et un conteneur d'apprentissage automatique pré-construit séparé.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul (serveur) | GKE Autopilot | Image personnalisée sur `ghcr.io/immich-app/immich-server`, port 2283, 2 vCPU / 4 Gio, **exactement un réplica** |
| Calcul (ML) | GKE Autopilot | `ghcr.io/immich-app/immich-machine-learning` pré-construit, port 3003, interne uniquement, inférence CPU (pas de GPU), 2 vCPU / 4 Gio |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — avec l'extension `pgvector` (`DB_VECTOR_EXTENSION=pgvector` ; Cloud SQL n'a pas de VectorChord) |
| Médiathèque | NFS (volume de plateforme partagé) | Monté à `/usr/src/app/upload` (`IMMICH_MEDIA_LOCATION`) — Immich n'a pas de backend de stockage d'objets |
| Cache et file d'attente | Redis | Requis — file d'attente de jobs et pub/sub d'Immich ; le Redis co-hébergé sur le serveur NFS est injecté par défaut |
| Build d'image | Cloud Build + Artifact Registry | Build personnalisé léger ajoutant le point d'entrée cloud |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **`enable_nfs = true` est validé, pas seulement par défaut.** L'intégralité de la bibliothèque photo/vidéo se trouve à `IMMICH_MEDIA_LOCATION` ; sans NFS, ce chemin est le disque éphémère du pod et chaque redémarrage efface la bibliothèque. Le plan échoue si vous le désactivez.
- **`enable_redis = true` est validé.** Immich refuse de démarrer sans Redis. Sans `redis_host` explicite, la plateforme injecte l'IP Redis co-hébergée sur le serveur NFS.
- **`max_instance_count = 1` est validé.** Une médiathèque NFS, un seul rédacteur ; les workers de jobs in-process d'Immich supposent une instance unique.
- **Le déploiement utilise la stratégie `Recreate`**, pas `RollingUpdate` — App_GKE bascule automatiquement pour les applications basées sur NFS, de sorte que les mises à jour de version entraînent une courte interruption au lieu de bloquer deux pods sur la même bibliothèque.
- **`application_version = "latest"` se résout en tag `release` roulant d'Immich.** Immich publie les tags `release` et `vX.Y.Z` mais pas `latest` ; la couche partagée mappe `latest` → `release` via l'ARG de build `IMMICH_VERSION` spécifique à l'application, et l'image d'apprentissage automatique utilise le même tag résolu (en pas à pas).
- **pgvector est le backend vectoriel.** Cloud SQL n'a pas de VectorChord (l'extension préférée d'Immich) ; Immich s'exécute sur son fallback pgvector documenté. Le job `db-init` pré-crée les extensions `vector` et `earthdistance`.
- **Les sondes atteignent `GET /api/server/ping`** — le point de terminaison de vivacité non authentifié d'Immich (`{"res":"pong"}`).
- **Pas de secrets au niveau de l'application.** Les clés de signature JWT d'Immich vivent dans la base de données ; `DB_PASSWORD` est injecté par la fondation sous le nom exact qu'Immich lit.
- **La première exécution est interactive.** Visitez l'interface web et créez le compte administrateur sur l'écran d'inscription ; les applications mobiles Immich (iOS/Android) se connectent ensuite à la même URL de serveur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le serveur Immich et les charges de travail ML {#a-gke-autopilot--the-immich-server-and-ml-workloads}

Le déploiement du serveur exécute un seul réplica ; le service d'apprentissage automatique s'exécute en tant que second déploiement dans le même espace de noms, accessible uniquement à l'intérieur du cluster.

- **Console :** Kubernetes Engine → Charges de travail → filtrez par l'espace de noms pour voir les deux déploiements, pods et événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods -A | grep immich                       # find the namespace fast
  kubectl get pods,svc,deploy -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o name | grep -v ml | head -1 | cut -d/ -f2)" --tail=100
  # The cloud entrypoint logs the resolved DB/Redis/media config on the first lines:
  kubectl logs -n "$NAMESPACE" <server-pod> | head -15
  # Confirm the ML URL wiring:
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- env | grep IMMICH_MACHINE_LEARNING_URL
  ```

### B. Cloud SQL pour PostgreSQL 15 + pgvector {#b-cloud-sql-for-postgresql-15--pgvector}

Immich stocke toutes les métadonnées (utilisateurs, albums, actifs, EXIF, embeddings de recherche intelligente, données de reconnaissance faciale) dans Cloud SQL PostgreSQL 15, accessible via le sidecar **Cloud SQL Auth Proxy**. Le job `db-init` du premier déploiement crée la base de données et l'utilisateur et pré-crée les extensions `pgvector` et `earthdistance` ; Immich s'exécute avec `DB_VECTOR_EXTENSION = pgvector` car Cloud SQL n'offre pas VectorChord.

- **Console :** SQL → sélectionnez l'instance.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Inside psql — confirm the vector extension:
  #   SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','earthdistance');
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs).

### C. NFS — la médiathèque {#c-nfs--the-media-library}

Le volume NFS partagé de la plateforme est monté à `/usr/src/app/upload`
(`IMMICH_MEDIA_LOCATION`). Chaque original, miniature et vidéo encodée y réside ; le pod lui-même est jetable.

- **CLI :**
  ```bash
  # The NFS server is a Compute Engine VM managed by Services_GCP:
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  # Verify the mount and library content from inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- df -h /usr/src/app/upload
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- ls /usr/src/app/upload
  ```

### D. Redis (file d'attente de jobs et pub/sub) {#d-redis-job-queue-and-pubsub}

Immich met en file d'attente chaque job d'arrière-plan (génération de miniatures, extraction de métadonnées, embedding de recherche intelligente, détection de visages) via Redis. Par défaut, la VM du serveur NFS co-héberge Redis et la plateforme injecte son IP en tant que `REDIS_HOST` ; le point d'entrée cloud la mappe à `REDIS_HOSTNAME` d'Immich et **échoue rapidement** si elle se résout vide.

- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- env | grep -E 'REDIS_HOST'
  ```

### E. Apprentissage automatique — recherche intelligente CLIP et reconnaissance faciale {#e-machine-learning--clip-smart-search-and-face-recognition}

Le conteneur `ghcr.io/immich-app/immich-machine-learning` pré-construit sert les embeddings CLIP, la reconnaissance faciale et l'OCR via HTTP sur le port 3003 (interne uniquement). Il s'agit d'une inférence CPU — pas de GPU. Son environnement définit `IMMICH_PORT = "3003"` explicitement : la fondation propage l'environnement du serveur dans des services supplémentaires et l'image ML lit la même variable `IMMICH_PORT` — sans la surcharge, elle hérite de 2283, lie le mauvais port, et sa sonde de démarrage `:3003` ne passe jamais. Le serveur le trouve via `IMMICH_MACHINE_LEARNING_URL` injecté, défini via `module_env_vars` sur le **nom DNS réel du service Kubernetes** (`http://<service>-ml:3003` — le service est nommé `<service>-ml`) ; le mécanisme `output_env_var_name` de la fondation compose une URL sans nom non résolvable (`http://ml:3003`), de sorte que sa sortie est garée dans la variable d'environnement inutilisée `IMMICH_ML_URL_FOUNDATION_UNUSED`. Les fichiers de modèle se téléchargent paresseusement **à la première utilisation** dans `/cache` sur le disque éphémère du pod (re-téléchargés après la replanification — accepté).

- **CLI :**
  ```bash
  kubectl get pods -n "$NAMESPACE" | grep ml
  kubectl logs -n "$NAMESPACE" deploy/<ml-deploy> --tail=50    # model downloads + inference requests
  ```

### F. Cloud Build et Artifact Registry {#f-cloud-build--artifact-registry}

L'image du serveur est un build personnalisé léger (`FROM ghcr.io/immich-app/immich-server` plus le point d'entrée cloud) produit par Cloud Build et stocké dans Artifact Registry. L'ARG de build `IMMICH_VERSION` contient le tag résolu — spécifique à l'application à dessein, car la fondation injecte `APP_VERSION` et gagne la fusion, et Immich n'a pas de tag `latest`.

- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/"$PROJECT"/<repo> 2>/dev/null | grep immich
  ```

### G. Réseau, journalisation et surveillance {#g-networking-logging--monitoring}

L'accès externe se fait via une IP Cloud Load Balancing (`service_type = LoadBalancer`) ; un domaine personnalisé avec un certificat géré et une IP statique réservée sont activés par défaut (`enable_custom_domain = true`, `reserve_static_ip = true`).

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Immich {#3-immich-application-behaviour}

- **Le point d'entrée cloud mappe les noms d'environnement au moment de l'exécution.** Le `cloud-entrypoint.sh` de l'image personnalisée mappe les `DB_HOST`/`DB_IP` injectés par la fondation → `DB_HOSTNAME` (réécrivant un chemin de répertoire de socket Auth Proxy en `127.0.0.1` TCP), `DB_USER` → `DB_USERNAME`, `DB_NAME` → `DB_DATABASE_NAME`, et `REDIS_HOST` → `REDIS_HOSTNAME`/`REDIS_PORT` — la fondation peut injecter `REDIS_HOST` comme `host` ou `host:port`, de sorte que le point d'entrée le divise en un nom d'hôte nu plus un port (par défaut `6379` lorsqu'il n'est pas présent). Les références Kubernetes `$(VAR)` ne pourraient pas faire cela : K8s résout `$(VAR)` uniquement par rapport aux entrées d'environnement définies *plus tôt* dans la liste rendue alphabétiquement, et `DB_DATABASE_NAME` trie avant `DB_NAME`, donc `$(DB_NAME)` resterait une chaîne littérale. `DB_PASSWORD` n'a pas besoin de mappage. Le point d'entrée résout également le script de démarrage en amont à travers les dispositions d'image — Immich v3 a déplacé l'application vers `/usr/src/app/server` (script de démarrage à `server/bin/start.sh`) tandis que les images plus anciennes conservent `/usr/src/app/start.sh` ; les deux sont sondés et le répertoire de travail ajusté avant `exec`. Le point d'entrée imprime la configuration résolue en haut du journal du pod — toujours le premier endroit où chercher.
- **Configuration de la base de données au premier déploiement.** Le job `db-init` (`postgres:15-alpine`) exécute `db-init.sh` de manière idempotente : utilisateur, base de données, octrois, extensions `pgvector` + `earthdistance`, et un octroi `cloudsqlsuperuser` afin que les migrations en amont puissent gérer les extensions elles-mêmes. Immich applique ses propres migrations de schéma à chaque démarrage.
- **Un seul rédacteur, déploiements de recréation.** Étant donné que la médiathèque est un seul système de fichiers NFS et que les workers de jobs s'exécutent en interne, un seul réplica est autorisé (validé au moment du plan), et les mises à jour de version remplacent le pod par `Recreate` (brève interruption) plutôt qu'une montée en puissance progressive.
- **La recherche intelligente et la reconnaissance faciale sont asynchrones.** Après un téléchargement, le serveur met en file d'attente des jobs qui appellent le service ML ; la première requête de recherche intelligente déclenche également le téléchargement du modèle CLIP, elle est donc sensiblement lente une fois par durée de vie du pod ML. La progression des jobs est visible dans l'interface web sous Administration → Jobs.
- **Administrateur de première exécution.** Lors de la première visite, l'interface web affiche l'écran d'inscription ; le premier compte enregistré devient l'administrateur. Les applications iOS/Android d'Immich se connectent à la même URL de serveur pour la sauvegarde automatique mobile.
- **La télémétrie est désactivée** (`IMMICH_TELEMETRY_INCLUDE = ""`) et `IMMICH_ENV =
  production` ; l'API et les workers d'arrière-plan s'exécutent dans un seul conteneur (l'amont a fusionné le conteneur de microservices en v1.106).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Immich sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Repli de région lorsque la découverte réseau ne peut pas la déterminer. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `immich` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image du serveur + ML, maintenu en pas à pas. `latest` se résout en tag `release` roulant d'Immich (aucun tag `latest` n'existe en amont) ; épinglez `vX.Y.Z` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | Ressources du conteneur du serveur. |
| `container_port` | `2283` | Port natif d'Immich (`IMMICH_PORT`). |
| `min_instance_count` | `1` | Maintenez à 1 pour qu'Immich soit toujours disponible. |
| `max_instance_count` | `1` | **Doit être 1** — validé au moment du plan (un seul rédacteur NFS, workers in-process). |
| `ml_cpu_limit` / `ml_memory_limit` | `2000m` / `4Gi` | Ressources du conteneur d'apprentissage automatique. Les modèles CLIP + visage nécessitent ~2–3 Gio résidents ; 4 Gio est la valeur par défaut sûre. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir les images dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires fusionnés sur les valeurs par défaut d'Immich (`IMMICH_PORT`, `IMMICH_MEDIA_LOCATION`, `DB_VECTOR_EXTENSION`, `IMMICH_ENV`, télémétrie). Ne définissez pas `DB_*`/`REDIS_*` ici — le point d'entrée gère le mappage. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface web et les applications mobiles. |
| `session_affinity` | `ClientIP` | Routage persistant (un seul réplica, donc principalement sans objet). |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `60` | Délai avant l'arrêt forcé. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/server/ping`, délai 30s, 30×10s | Sonde de démarrage de l'application (Groupe 14 sur la plateforme). |
| `liveness_probe` | HTTP `/api/server/ping`, délai 30s | Sonde de vivacité de l'application. |
| `uptime_check_config` | désactivé, chemin `/api/server/ping` | Test de disponibilité Cloud Monitoring optionnel. |

### Groupe 11 — Jobs et services supplémentaires {#group-11--jobs--additional-services}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour le job `db-init` intégré. Immich migre son propre schéma au démarrage. |
| `additional_services` | `[]` | Ajouté après le service d'apprentissage automatique intégré. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Doit rester vrai** — validé au moment du plan. L'intégralité de la médiathèque réside sur NFS ; Immich n'a pas de backend S3/GCS. |
| `nfs_mount_path` | `/usr/src/app/upload` | Monté exactement à `IMMICH_MEDIA_LOCATION`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `immich_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `immich_user` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée de la base de données et de NFS (UTC). |
| `backup_retention_days` | `7` | Augmenter pour la production — la bibliothèque NFS est la seule copie de vos photos. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | API Gateway + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** les applications mobiles Immich s'authentifient auprès du serveur Immich, et non de Google — l'IAP devant l'API interrompt la sauvegarde automatique mobile à moins que chaque appareil ne puisse effectuer le flux de connexion Google.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Nécessite un domaine personnalisé et les deux identifiants OAuth (validé). |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Doit rester vrai** — validé au moment du plan ; Immich refuse de démarrer sans Redis. |
| `redis_host` | `""` | Vide = l'IP Redis co-hébergée sur le serveur NFS est injectée. |
| `enable_cloud_armor` | `false` | Attacher une politique WAF au backend Ingress. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Entrées App_GKE standard : `enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`,
`organization_id`, `enable_audit_logging`. Voir [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel les charges de travail s'exécutent. |
| `service_cluster_ip` / `stage_service_cluster_ips` | ClusterIPs intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `web_url` | URL de l'interface web Immich — IP externe du LoadBalancer si disponible, sinon URL interne du cluster. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Détails du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` et sorties GitHub/trigger | État et détails CI/CD. |
| `kubernetes_ready` | Indique si toutes les ressources Kubernetes ont été déployées (faux lors du premier apply d'un nouveau cluster inline). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan.** `Immich_GKE` comporte ses propres gardes de validation en plus des vérifications de la fondation [App_GKE](App_GKE.md) : `enable_nfs = false`, `enable_redis = false`, `max_instance_count > 1`, Redis sans source d'hôte, et IAP sans identifiants OAuth échouent tous le **plan** avec une erreur nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` (validé) | Critique | Avec NFS désactivé, toute la médiathèque se trouve sur le disque éphémère du pod — **chaque replanification du pod efface toutes les photos et vidéos**. Immich n'a pas de backend S3/GCS pour se replier. Bloqué au moment du plan. |
| `max_instance_count` | `1` (validé) | Critique | Plus d'un réplica signifie plusieurs rédacteurs sur une seule bibliothèque NFS et des workers de jobs in-process dupliqués — corruption de la bibliothèque et jobs en concurrence. Bloqué au moment du plan. |
| `db_name` / `db_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les métadonnées d'actifs, les albums et les utilisateurs. |
| `backup_retention_days` | Augmenter pour la production | Élevé | La bibliothèque NFS est la seule copie des médias ; 7 jours de sauvegardes sont minces pour une archive photo. |
| `enable_redis` / `redis_host` | `true` / `""` (validé) | Élevé | Sans Redis, le serveur se ferme au démarrage (le point d'entrée échoue rapidement avec une erreur claire). Avec Redis activé mais sans NFS et sans hôte explicite, `REDIS_HOST` est vide — également bloqué au moment du plan. |
| Surcharge ML `IMMICH_PORT` | Conserver le `IMMICH_PORT = "3003"` intégré sur le service ML | Élevé | La fondation propage l'environnement du serveur dans des services supplémentaires, et l'image ML lit la **même variable `IMMICH_PORT`** que le serveur — sans la surcharge, le conteneur ML hérite de `2283`, lie le mauvais port, et sa sonde de démarrage `:3003` ne passe jamais (le déploiement ML ne devient jamais Prêt). |
| `IMMICH_MACHINE_LEARNING_URL` | Laisser l'URL DNS réelle injectée telle quelle | Élevé | Le mécanisme `output_env_var_name` de la fondation compose l'URL à partir du nom de service supplémentaire nu (`http://ml:3003`), mais le service qu'il crée est nommé `<service>-ml` — le nom nu ne se résout pas et la recherche intelligente/reconnaissance faciale échouent. Le module injecte l'URL DNS réelle du service via `module_env_vars` et gare la valeur composée par la fondation dans la variable d'environnement inutilisée `IMMICH_ML_URL_FOUNDATION_UNUSED`. |
| `ml_memory_limit` | `4Gi` (par défaut ; à considérer comme le minimum) | Moyen | En dessous des ~2–3 Gio dont les modèles CLIP + visage ont besoin en résident, le chargement du modèle tue le pod ML par OOM — **la recherche intelligente et la reconnaissance faciale échouent silencieusement tandis que l'application principale semble parfaitement saine** (les téléchargements et la navigation fonctionnent toujours). Surveillez les redémarrages `OOMKilled` sur le pod ML. |
| `enable_iap` | `false` à moins que l'accès mobile ne soit géré | Moyen | L'IAP intercepte l'API que les applications mobiles appellent ; la sauvegarde automatique est interrompue pour les appareils qui ne peuvent pas effectuer la connexion Google. |
| `application_version` | `latest` (→ `release`) ou un `vX.Y.Z` épinglé | Moyen | Définir un tag qui n'existe pas en amont fait échouer le build/pull ; les tags du serveur et du ML sont maintenus en pas à pas automatiquement — ne les pointez pas manuellement vers des versions différentes. |
| Mises à jour de version | Attendez-vous à une brève interruption | Faible | Les applications basées sur NFS se déploient avec la stratégie `Recreate` — l'ancien pod s'arrête avant le démarrage du nouveau. C'est intentionnel (les mises à jour progressives se bloquent sur la bibliothèque partagée). |
| pgvector vs VectorChord | Accepter pgvector sur Cloud SQL | Faible | Les builds et les requêtes d'index de recherche intelligente sont plus lents que VectorChord préféré d'Immich — attendu sur Cloud SQL, qui n'offre pas VectorChord. Fonctionnellement complet, juste plus lent sur les grandes bibliothèques. |
| Latence de la première requête ML | Attendez-vous à une première recherche lente | Faible | Les modèles CLIP/visage se téléchargent à la première utilisation (cache sur disque éphémère, re-téléchargés après la replanification du pod ML) — la première requête de recherche intelligente après un déploiement est lente. |
| Chemin de la sonde de démarrage | `/api/server/ping` | Faible | Tout point de terminaison authentifié renvoie 401/403 à la sonde kubelet non authentifiée et bloque le déploiement ; conservez la valeur par défaut. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La couche d'application partagée spécifique à Immich (image,
point d'entrée, bootstrap de base de données, sondes) est décrite dans
**[Immich_Common](Immich_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Immich sur GKE Autopilot](../labs/Immich_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Immich Common — Configuration d'application partagée](Immich_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [Filebrowser sur GKE Autopilot](Filebrowser_GKE.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md), [Kopia sur GKE Autopilot](Kopia_GKE.md) dans la solution **Personal Cloud**.
