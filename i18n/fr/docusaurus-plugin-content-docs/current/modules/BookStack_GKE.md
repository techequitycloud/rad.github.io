---
title: "BookStack sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de BookStack sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/BookStack_GKE.md @ 1665a43e sha256:25b7ff2085a6 -->

# BookStack sur GKE Autopilot {#bookstack-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/BookStack_GKE.png" alt="BookStack sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

BookStack est une plateforme wiki et de documentation gratuite, open source, sous
licence MIT, basée sur Laravel (PHP), organisant le contenu en Étagères → Livres
→ Chapitres → Pages avec édition WYSIWYG et Markdown, recherche en texte
intégral, révisions de pages et permissions granulaires. Ce module déploie
BookStack sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par BookStack et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
—, reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## Ce que coûte BookStack sur RAD, et comment cela se compare {#what-bookstack-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de BookStack sur RAD coûte environ 110 US$ par mois
dans votre propre projet Google Cloud, sans frais de licence supplémentaires**
— BookStack est open source. Dans un projet géré par RAD pour vous, le même
déploiement est facturé à **99 crédits par jour** (environ 2 970 par mois,
environ 297 US$ au prix de la recharge). Ou consultez le [guide Cloud
Run](BookStack_CloudRun.md) pour l'option moins chère. Si vous n'avez besoin de
BookStack qu'occasionnellement — études, démo, projet de courte durée —, un
projet géré par RAD peut être supprimé et restauré dans les 30 jours pour
quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars
seulement. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

BookStack est open source, il n'y a donc pas de frais de licence. Vous payez
pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, environ 2 970 par mois (environ 297 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, donc une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de cluster GKE partagé)** | **environ 110 US$** |

Les prix des pods Cloud SQL et Cloud Run/GKE sont les mêmes dans
africa-south1 (Johannesburg) ; la petite VM coûte environ 10 % de plus là-bas.

- **GKE Autopilot ne se met pas à l'échelle à zéro.** Au moins un pod est
  toujours en cours d'exécution, donc le coût ci-dessus s'applique que
  l'application soit utilisée ou non ; des pods supplémentaires ne sont ajoutés
  que sous charge.

### Comment cela se compare, pour le wiki d'une petite équipe {#how-it-compares-for-a-small-teams-wiki}

Le projet BookStack lui-même ne vend pas d'hébergement ; une poignée de
fournisseurs tiers listent l'hébergement BookStack sur la page des sponsors de
bookstackapp.com, mais RAD n'a pas récupéré de prix actuel auprès d'eux, donc
aucun n'est cité ici. La comparaison qui peut être vérifiée est un serveur nu :

- Un Hetzner CPX22 ou un droplet DigitalOcean (2 vCPU/4 Go, environ 24 US$/mois)
  ou un GCP e2-standard-2 (2 vCPU/8 Go, environ 49 US$/mois) exécuterait
  BookStack et sa base de données MySQL.
- Sur un VPS nu, vous gérez vous-même MySQL, les sauvegardes, les correctifs de
  sécurité et les mises à niveau. Le module de RAD vous offre Cloud SQL géré,
  Secret Manager et Cloud Monitoring pour les frais de module plus l'utilisation
  de Google Cloud ci-dessus.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si BookStack s'exécute dans **un projet géré par RAD pour vous**, la
suppression de l'ensemble du projet — plutôt que la suppression de ce seul
module — délie d'abord sa facturation, puis demande à Google de supprimer
définitivement le projet. Google le conserve, récupérable, pendant 30 jours, et
parce que la facturation est déjà déliée, rien n'est facturé pendant qu'il
attend. Contrairement à la suppression d'un module, cela ne supprime pas Cloud
SQL, une VM ou la ressource de calcul un par un : l'ensemble du projet s'arrête
simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut demander à Google de restaurer le projet
  et de rattacher son compte de facturation, puis d'exécuter **Update** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes, et une mise à jour ne facture jamais les frais de module à nouveau.
  Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte
  que quelques crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce qu'il faut.** Vous devez posséder le projet (pas un projet dont RAD gère
  uniquement la facturation), le restaurer vous-même dans les 30 jours — après
  quoi Google le supprime définitivement — et effacer à nouveau le seuil
  d'admission du palier (100 crédits pour le palier sandbox que la plupart des
  utilisations d'étude/démo conviennent). Google indique que la plupart des
  services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
  restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  a la suppression logicielle de Cloud Storage désactivée, il est donc très
  probable qu'il disparaisse dès que le projet est supprimé — même si le projet
  lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a
  quelque chose à conserver ; pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
ci-dessus est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds : environ 114 crédits (environ 11,40 US$) au prix de la recharge, et
  environ 15 à 20 minutes de temps de build (moyenne de la plateforme RAD). La
  suppression ne permet d'économiser de l'argent que si BookStack devait rester
  inutilisé pendant environ **2 jours ou plus** — dans votre propre projet, cela
  représente environ 3,67 US$ par jour, et dans un projet géré par RAD, c'est 99
  crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données
  et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de
  BookStack pendant qu'une autre application partage le projet n'économise que
  la partie calcul de BookStack.
- **Conservez les données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
  la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde sur le bucket de
sauvegarde ; les prix changent, vérifiez chaque source avant de vous fier à un
chiffre.

## 1. Vue d'ensemble {#1-overview}

BookStack s'exécute comme une charge de travail web PHP sur GKE Autopilot. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP (LinuxServer), 1 vCPU / 2 Gio par défaut, réplica unique (basé sur NFS) |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — BookStack ne prend pas en charge PostgreSQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié (`gcs-bookstack<tenant>-data`) provisionné automatiquement |
| Fichiers persistants | Filestore / NFS | Images et pièces jointes téléchargées persistantes à `/var/lib/bookstack` |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; BookStack utilise le pilote de cache/session local |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré + IP statique par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`database_type = "MYSQL_8_0"`) ; PostgreSQL n'est pas pris en
  charge et la sélection d'un autre moteur interrompt le démarrage.
- **L'image `linuxserver/bookstack` pré-construite est utilisée directement.** Il n'y a pas
  de Cloud Build personnalisé ; l'image officielle LinuxServer.io est mise en
  miroir dans Artifact Registry (`enable_image_mirroring = true`) et déployée telle quelle.
- **Le conteneur écoute sur le port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **La persistance NFS des téléchargements est activée par défaut.** `enable_nfs = true`
  monte NFS à `/var/lib/bookstack` afin que les images et pièces jointes téléchargées
  survivent aux redémarrages, aux redéploiements et à la replanification des
  pods. Comme BookStack est basé sur NFS, le déploiement utilise la stratégie de
  mise à jour `Recreate` (un seul pod contre le volume partagé).
- **Un seul réplica est maintenu** (`min_instance_count = 1`, `max_instance_count = 1` ; GKE n'a pas de
  mise à l'échelle à zéro). Ne pas dépasser un pod sans coordination externe de
  session/cache — plusieurs pods contre le même volume NFS et le même blocage
  de base de données.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application
  Laravel est générée une fois et stockée dans Secret Manager ; sa rotation rend
  toutes les valeurs de base de données chiffrées indéchiffrables.
- **L'image exécute `php artisan migrate --force` automatiquement au démarrage**, de sorte que le
  schéma est créé au premier démarrage après que `db-init` ait provisionné la
  base de données et l'utilisateur — il n'y a pas de job de migration séparé.
- **Un administrateur par défaut est initialisé** par l'image LinuxServer :
  `admin@admin.com` avec le mot de passe `password`. Changez-le immédiatement lors de la
  première connexion.
- **GKE se connecte à Cloud SQL via le sidecar Auth Proxy** sur `127.0.0.1:3306`
  (`enable_cloudsql_volume = true`), et le câblage GKE remplace `DB_HOST = "127.0.0.1"`.
- **Un domaine personnalisé, un certificat géré et une IP statique réservée
  sont activés par défaut** (`enable_custom_domain = true`, `reserve_static_ip = true`), avec `session_affinity = "ClientIP"` pour
  les sessions d'interface utilisateur persistantes.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail BookStack {#a-gke-autopilot--the-bookstack-workload}

Les pods BookStack sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Comme l'application est basée sur NFS, la
charge de travail s'exécute en tant que déploiement à réplica unique utilisant
la stratégie `Recreate`.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail BookStack pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy/<service-name> -n "$NAMESPACE"    # strategy, events
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

BookStack stocke toutes les données de l'application (livres, pages,
utilisateurs, révisions, permissions) dans une instance Cloud SQL pour MySQL 8.0
gérée. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:3306` (`enable_cloudsql_volume = true`) ; aucune IP publique n'est exposée. Lors du
premier déploiement, un job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (`storage_buckets` par défaut : `name_suffix = "data"`,
résultant en `gcs-bookstack<tenant>-data`) est provisionné automatiquement. Le compte de
service de la charge de travail se voit accorder l'accès. Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache et sessions facultatifs) {#d-redis-optional-cache--sessions}

Redis est **désactivé par défaut** (`enable_redis = false`) ; BookStack utilise ses
pilotes de cache et de session locaux. Lorsque `enable_redis = true` est défini, la
couche partagée injecte `REDIS_HOST` et `REDIS_PORT`. Lorsque `redis_host`
est laissé vide et `enable_nfs` est vrai, l'IP Redis co-hébergée de la VM du
serveur NFS est utilisée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the DB wiring injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|REDIS_'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : la **`APP_KEY`** Laravel (`base64:<44-char base64>`), utilisée pour
chiffrer toutes les données d'application que BookStack stocke chiffrées. Le mot
de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing avec un domaine personnalisé et un certificat géré par Google
(`enable_custom_domain = true`), et une IP statique est réservée (`reserve_static_ip = true`) afin que
l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des règles
d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application BookStack {#3-bookstack-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il détecte
  le socket Cloud SQL ou le point de terminaison TCP, attend que MySQL soit
  accessible, crée la base de données et l'utilisateur de l'application, accorde
  les privilèges, vérifie que l'utilisateur de l'application peut se connecter
  et arrête gracieusement le sidecar Cloud SQL Auth Proxy. Le job est
  idempotent et peut être réexécuté en toute sécurité (`max_retries = 3`).
- **Auto-migration du schéma au démarrage.** L'image LinuxServer BookStack
  exécute `php artisan migrate --force` automatiquement à chaque démarrage de conteneur, de sorte
  que le schéma est créé au premier démarrage et mis à niveau lors des démarrages
  ultérieurs — il n'y a **pas de job de migration séparé**.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application
  Laravel est générée une fois et écrite dans Secret Manager. Sa rotation rend
  toutes les valeurs de base de données chiffrées (secrets à deux facteurs,
  certains paramètres) définitivement indéchiffrables. Ne la faites pivoter que
  pendant une fenêtre de maintenance planifiée avec un plan de rechiffrement.
- **Administrateur de première exécution.** L'image initialise un compte
  administrateur par défaut, `admin@admin.com` / `password`. Changez le mot de
  passe (et idéalement l'e-mail) immédiatement après la première connexion.
- **Les fichiers téléchargés résident sur NFS.** Les images, les pièces jointes
  et les autres téléchargements sont stockés sur le système de fichiers sous
  `/var/lib/bookstack`, qui est basé sur NFS par défaut. Le déploiement utilise donc la
  stratégie `Recreate` afin qu'un seul pod écrive sur le volume partagé — ne
  passez pas à plusieurs réplicas sans coordination externe.
- **Chemin de santé.** La sonde de vivacité cible `/status` par défaut — le
  point de terminaison de santé JSON non authentifié de BookStack qui rapporte
  l'état de l'application/base de données/cache/session. La sonde de démarrage
  est une vérification TCP. Prévoyez une fenêtre généreuse de premier démarrage
  (délai initial de 300 secondes) pour les migrations automatiques.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
BookStack sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `bookstack` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `BookStack` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `BookStack wiki on GKE Autopilot` | Description de la charge de travail. |
| `application_version` | `latest` | Tag d'image `linuxserver/bookstack` ; épingler (par exemple `version-v24.10`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déployer directement l'image LinuxServer mise en miroir — pas de build personnalisé. |
| `container_image` | `""` | Remplacer la référence de l'image ; laisser vide pour utiliser la valeur par défaut mise en miroir. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image LinuxServer dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Réplicas minimum ; maintenir à 1 (pod unique basé sur NFS). |
| `max_instance_count` | `1` | Réplicas maximum. Ne pas augmenter sans coordination externe de session/cache. |
| `container_port` | `80` | BookStack écoute sur le port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `cpu_limit` | `1000m` | CPU par pod ; 1 vCPU par défaut. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (`127.0.0.1:3306`) ; requis sur GKE. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `APP_URL`, configuration de messagerie). Ne pas définir `APP_KEY` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout en `Deployment` (par défaut) sauf si un StatefulSet est demandé. |
| `session_affinity` | `ClientIP` | Le routage persistant maintient la session UI d'un client sur un seul pod. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laisser désactivé — BookStack utilise NFS, pas des PVC par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod (si activé). |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Quota CPU. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Quota mémoire — utiliser des unités binaires (`4Gi`, `8192Mi`). |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Quotas de nombre d'objets. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, chemin `/status`, 30s | Sonde de démarrage (vérification d'écoute de port). |
| `liveness_probe` | HTTP `/status`, délai de 300s | Sonde de vivacité contre le point de terminaison de santé non authentifié de BookStack. |
| `startup_probe_config` / `health_check_config` | Sondes de niveau App_GKE | Sondes de niveau infrastructure. |
| `uptime_check_config` | désactivé | Vérification de disponibilité facultative de Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de BookStack. |

### Groupe 12 — CI/CD et autorisation binaire {#group-12--cicd--binary-authorization}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Persister les images/pièces jointes téléchargées sur NFS. La désactivation entraîne la perte des téléchargements lors du redéploiement. |
| `nfs_mount_path` | `/var/lib/bookstack` | Chemin de montage où BookStack stocke les téléchargements. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Découverte/nommage du serveur NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket `data` par défaut et tous ceux de `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images Artifact Registry récentes à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 15 — Cache et sessions Redis {#group-15--redis-cache--sessions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Injecter `REDIS_HOST`/`REDIS_PORT` afin que BookStack puisse utiliser Redis pour le cache/les sessions. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — BookStack nécessite MySQL 8.0. |
| `application_database_name` | `bookstack` | Nom de la base de données MySQL (préfixé par le locataire). Immuable après le premier déploiement. |
| `application_database_user` | `bookstack` | Utilisateur de la base de données de l'application (préfixé par le locataire). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods en continu. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL
à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** L'activation d'IAP nécessite une authentification par
> identité Google pour **toutes** les requêtes entrantes, bloquant les lecteurs
> anonymes du wiki. N'activez IAP que lorsque la documentation ne doit pas être
> lisible publiquement.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant BookStack. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une règle Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre BookStack. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas au moteur requis par BookStack, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les valeurs de la base de données chiffrées (secrets à deux facteurs, certains paramètres) indéchiffrables de manière permanente. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_file` valide fait échouer le job d'importation. |
| `database_type` | `MYSQL_8_0` | Critique | BookStack nécessite MySQL ; tout autre moteur empêche le démarrage. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `APP_URL` | Laisser au module (résolu à l'URL de l'équilibreur de charge au moment du déploiement) ; remplacer via `environment_variables` uniquement pour un domaine personnalisé | Élevé | Une URL de base erronée rompt le chargement des ressources, les liens et les redirections de connexion — BookStack s'affiche sans style. |
| `enable_nfs` | `true` | Élevé | La désactivation entraîne la perte de toutes les images et pièces jointes téléchargées lors du redéploiement ou du replanification des pods. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures risquent des arrêts OOM en cas d'édition concurrente et d'indexation plein texte. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité MySQL sur GKE ; sa désactivation rompt la connectivité de la base de données (elle n'est pas bloquée au moment de la planification). |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; garder 1 est correct pour le déploiement à pod unique basé sur NFS. |
| `max_instance_count` | `1` | Élevé | Plusieurs pods sur le même volume NFS et la même base de données s'interbloquent ; ne pas mettre à l'échelle sans coordination externe. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions d'interface utilisateur rebondissent entre les pods (pertinent uniquement si jamais mis à l'échelle >1). |
| `liveness_probe` chemin | `/status` (par défaut) | Moyen | Pointer la sonde vers un autre chemin ne renvoie jamais un état sain pour BookStack — `/status` est son point de terminaison de santé JSON non authentifié. |
| `enable_iap` | uniquement lorsque les lecteurs doivent s'authentifier | Élevé | IAP bloque tout accès anonyme, y compris les lecteurs de documentation publique. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à BookStack
partagée avec la variante Cloud Run est décrite dans
**[BookStack_Common](BookStack_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : BookStack sur GKE](../labs/BookStack_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [BookStack sur Google Cloud Run](BookStack_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [BookStack Common — Configuration d'application partagée](BookStack_Common.md) — la configuration partagée par les deux cibles de déploiement.
