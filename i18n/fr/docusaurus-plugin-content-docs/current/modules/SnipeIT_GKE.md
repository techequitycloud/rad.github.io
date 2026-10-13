---
title: "Snipe-IT sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Snipe-IT sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SnipeIT_GKE.md @ e69407af sha256:7e25d9d70784 -->

# Snipe-IT sur GKE Autopilot {#snipe-it-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SnipeIT_GKE.png" alt="Snipe-IT sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Snipe-IT est un système de gestion des actifs informatiques et des stocks,
libre et open source, utilisé pour suivre le matériel, les licences logicielles,
les accessoires et les consommables, avec enregistrement/retrait des actifs,
journalisation d'audit, amortissement et une API REST complète. Il est basé sur
Laravel/PHP et fonctionne derrière Apache. Ce module déploie Snipe-IT sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Snipe-IT et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— veuillez vous référer au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## Ce que coûte Snipe-IT sur RAD, et comparaison {#what-snipe-it-costs-on-rad-and-how-that-compares}

**L'exécution de Snipe-IT dans votre propre projet GCP coûte environ 110,13 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option la moins chère ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~110,13 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~99 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **110,13 $** |

### Comparaison {#how-it-compares}

- Les plans hébergés officiels de Snipe-IT commencent à **39,99 $/mois** (hébergement de base, utilisateurs et actifs illimités ; source : https://snipeitapp.com/pricing) — une alternative proche et directement comparable à l'exécution par vous-même.
- L'exécution par vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Un registre d'actifs est consulté occasionnellement pendant la journée de travail, pas en continu, de sorte que le coût d'exécution ci-dessous est déterminé par la base de données et le serveur de fichiers partagé, et non par le volume de requêtes.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un module, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de
calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Parce que
rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de
1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après
cela, Google le supprime définitivement — et la restauration est admise comme la création
d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des
utilisations d'étude/démo). Google affirme que la plupart des services fonctionnent à
nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé l'application et que vous souhaitez conserver ce travail, copiez
une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer.
Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Snipe-IT purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 110 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Snipe-IT resterait autrement inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données d'abord :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe.
  Chaque participant dispose de l'application dans son propre projet Google Cloud pendant
  15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit
  le formateur finance toutes les places, soit chaque participant paie la sienne. Tout
  est supprimé à la fin de la session et les crédits inutilisés sont reversés au
  formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  mise en pause et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin, le partenaire transfère le projet et les déploiements
  deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
  KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://snipeitapp.com/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Snipe-IT fonctionne comme une seule charge de travail web PHP/Apache tirée
directement de l'image Docker Hub officielle. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache `snipe/snipe-it` pré-construits sur le port 80, 1 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les images d'actifs téléchargées, les signatures, les codes-barres et le keystore d'exécution persistent sous `/var/lib/snipeit`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `snipeit-uploads` provisionné automatiquement |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-généré ; mot de passe de la base de données géré par le socle |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; nom de domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Image officielle pré-construite, pas de build personnalisé.** `container_image_source =
  "prebuilt"` déploie `snipe/snipe-it:<application_version>` (tag par défaut
  `v8-latest`) directement depuis Docker Hub, mis en miroir dans Artifact Registry lorsque
  `enable_image_mirroring = true`. Il n'y a pas d'étape Cloud Build/Dockerfile.
- **MySQL 8.0 est obligatoire.** `SnipeIT_Common` fixe `database_type =
  "MYSQL_8_0"` ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur le loopback.** La variante
  définit `enable_cloudsql_volume = true` et la configuration fusionnée force `DB_HOST =
  127.0.0.1` ; `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"`,
  `db_name_env_var_name = "DB_DATABASE"` et `db_password_env_var_name =
  "DB_PASSWORD"` — les noms d'environnement natifs de Laravel, pas les
  valeurs par défaut génériques `DB_*` du socle.
- **Réplica unique par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. `enable_pod_disruption_budget` par défaut `false` pour
  correspondre. L'état de session utilise `SESSION_DRIVER = "database"` afin que les sessions survivent
  aux redémarrages même avec un seul réplica.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à
  `/var/lib/snipeit`) afin que les images d'actifs téléchargées, les signatures et les codes-barres
  persistent et soient partagés entre les pods. `network_tags = ["nfsserver"]` est
  requis pour la connectivité NFS.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client atteignent le même
  pod.
- **Deux jobs d'initialisation ordonnés s'exécutent à chaque apply.** `db-init` (crée la
  base de données/utilisateur via `mysql:8.0-debian`) s'exécute en premier, puis `migrate` (`php
  artisan migrate --force` contre l'image `snipe/snipe-it`) — les deux
  `execute_on_apply = true`, sûrs à réexécuter.
- **Une `APP_KEY` Laravel est générée automatiquement** et stockée dans Secret
  Manager, injectée comme variable d'environnement secrète `APP_KEY`. La suppression/recréation de celle-ci
  invalide les sessions et toutes les données que Snipe-IT a chiffrées avec l'ancienne clé.
- **Redis est activé par défaut** (`enable_redis = true`) ; lorsque `redis_host` est
  vide, `REDIS_HOST` se résout à l'IP du serveur NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Snipe-IT {#a-gke-autopilot--the-snipe-it-workload}

Les pods Snipe-IT sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. La charge de travail est déployée en tant que
`Deployment` (pas
`StatefulSet`) lisant/écrivant l'état sur le volume NFS partagé et Cloud SQL.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Snipe-IT pour
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Snipe-IT stocke toutes les données de l'application (actifs, licences, accessoires,
consommables, utilisateurs, piste d'audit) dans une instance gérée de Cloud SQL pour MySQL 8.0.
Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init`
crée la base de données de l'application, l'utilisateur et les autorisations ; le job `migrate`
exécute ensuite `artisan migrate --force` de Laravel pour créer le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `snipeit-uploads`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder l'accès.
Séparément, l'arborescence des données d'exécution de Snipe-IT (images d'actifs téléchargées,
signatures, codes-barres, keystore) réside sur **NFS (Cloud Filestore)** à `/var/lib/snipeit`,
partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret Snipe-IT est généré automatiquement et stocké dans Secret Manager :
la `APP_KEY` Laravel (`base64:<...>`, 32 octets aléatoires encodés en base64). Le
mot de passe de la base de données est géré séparément par le socle. Sur GKE, les secrets
sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~snipeit"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). `enable_custom_domain = true` provisionne un Ingress Kubernetes ;
ajoutez des noms d'hôte via `application_domains` pour un certificat géré par Google.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers
Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles
(`uptime_check_config.enabled = false` par défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Snipe-IT {#3-snipe-it-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` s'exécute sur `mysql:8.0-debian`,
  créant de manière idempotente la base de données de l'application, l'utilisateur et les autorisations (sûr à
  réexécuter — `execute_on_apply = true`, `max_retries = 3`).
- **Job de migration explicite, pas d'auto-migration au démarrage.** Contrairement à certaines
  applications Laravel qui migrent au démarrage du conteneur, Snipe-IT exécute ici un job d'initialisation
  explicite `migrate` (`php /var/www/html/artisan migrate --force`, dépend de
  `db-init`, `max_retries = 2`) afin que le schéma soit prêt avant que la première révision de l'application
  ne serve le trafic. Le comportement d'auto-migration au démarrage de l'image officielle, le cas échéant,
  est un filet de sécurité secondaire.
- **Mappage des variables d'environnement de la base de données aux noms Laravel.** `main.tf` code en dur
  `db_user_env_var_name = "DB_USERNAME"`, `db_name_env_var_name =
  "DB_DATABASE"` et `db_password_env_var_name = "DB_PASSWORD"` afin que le
  socle injecte les identifiants de la base de données à portée du locataire directement sous les
  noms attendus par la configuration Laravel de Snipe-IT — aucun alias de point d'entrée n'est nécessaire.
  `DB_HOST` est forcé à `127.0.0.1` (le sidecar Auth Proxy) et `DB_PORT =
  "3306"` est défini par `SnipeIT_Common`.
- **Persistance de la session/cache/file d'attente.** `SnipeIT_Common` définit
  `SESSION_DRIVER = "database"`, `CACHE_DRIVER = "file"` et `QUEUE_DRIVER =
  "database"` afin que les sessions et les jobs en file d'attente survivent aux redémarrages des pods.
- **`APP_URL` est dérivé automatiquement.** `SnipeIT_Common` définit `APP_URL` à partir
  de l'URL de service GKE prédite lorsqu'elle est connue ; remplacez via
  `environment_variables` si vous attribuez un domaine personnalisé après le déploiement.
- **Chemin de santé.** La sonde de démarrage par défaut est **TCP** (délai initial de 30 s,
  période de 15 s, seuil d'échec de 20 — généreux pour permettre la configuration de la base de données au premier démarrage).
  La sonde de vivacité par défaut est **HTTP** `GET /` (délai initial de 300 s, période de 60 s,
  seuil d'échec de 3) — Snipe-IT sert sa page de connexion à `/`
  non authentifiée, confirmant que l'application PHP et la connexion à la base de données sont saines.
- **Inspectez les jobs d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DB_
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Snipe-IT sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `snipeit` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `v8-latest` | Tag de l'image officielle `snipe/snipe-it`. Utilisez une version épinglée en production. |
| `php_memory_limit` | `512M` | `memory_limit` PHP. Accepté mais non appliqué par `SnipeIT_Common` — l'image pré-construite conserve sa propre configuration PHP. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Taille de téléchargement / POST PHP. `upload_max_filesize` ne doit pas dépasser `post_max_size` (garde au moment de la planification) ; aucun n'est appliqué à l'image pré-construite. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie l'image officielle directement ; `"custom"` construirait via Cloud Build. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites CPU/mémoire par pod. |
| `container_port` | `80` | Snipe-IT (Apache) écoute sur le port 80. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Bornes de réplicas HPA. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE ; la garde au moment de la planification le rejette lorsque `database_type = "NONE"`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Snipe-IT. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les images/signatures/codes-barres d'actifs téléchargés persistent et soient partagés. Gardez-le activé. |
| `nfs_mount_path` | `/var/lib/snipeit` | Où Snipe-IT stocke les téléchargements et les données d'exécution. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST`/`REDIS_PORT`. La garde au moment de la planification exige que `redis_host` soit défini ou `enable_nfs = true` (l'IP du serveur NFS est l'hôte Redis de secours). |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Fixé par `SnipeIT_Common` ; les autres moteurs ne sont pas pris en charge. |
| `application_database_name` | `snipeit` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `snipeit` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour les noms d'hôte personnalisés. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS — ne pas supprimer sauf si NFS est désactivé. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Snipe-IT. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `migrate`) et d'importation (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification — un `StatefulSet` forcé
> à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*`
> donné comme des entiers bruts, un `container_port`/
> `backup_retention_days` hors de portée. `SnipeIT_GKE` ajoute ses propres gardes
> (`upload_max_filesize ≤ post_max_size`, `min_instance_count ≤
> max_instance_count`, Redis nécessite `redis_host` ou NFS, IAP nécessite les deux
> valeurs OAuth, `enable_cloudsql_volume` nécessite `database_type != "NONE"`). Une configuration invalide
> échoue la **planification** avec une erreur claire et nommée avant qu'aucune
> ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | Snipe-IT nécessite MySQL ; les autres moteurs ne sont pas pris en charge par `SnipeIT_Common`. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `APP_KEY` (auto-généré) | Ne jamais changer | Critique | La régénération de la clé Laravel après le premier démarrage invalide les sessions et toutes les données chiffrées avec l'ancienne clé (par exemple, les identifiants LDAP stockés). |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les images/signatures/codes-barres d'actifs téléchargés éphémères — isolés par pod et perdus au redémarrage. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité de la base de données sur GKE. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans comportement de stockage partagé/verrouillage vérifié risque des sessions divisées et des conflits de verrouillage NFS/DB. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions authentifiées. |
| `network_tags` | `["nfsserver"]` | Élevé | La suppression du tag alors que NFS est activé interrompt la connectivité pod-Filestore. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio, le pod PHP/Apache manque de mémoire sous charge. |
| `upload_max_filesize` / `post_max_size` | `upload_max_filesize ≤ post_max_size` | Moyen | Le mauvais ordre tronque silencieusement les téléchargements au niveau de la couche PHP ; la garde au moment de la planification le bloque, mais uniquement pour ces deux variables. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et toute URL mise en signet/intégrée à l'API. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement du socle référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Snipe-IT
partagée avec la variante Cloud Run (image, secret `APP_KEY`, jobs d'initialisation) est décrite
dans `modules/SnipeIT_Common/README.md` — il n'existe pas encore de guide `docs/modules/
SnipeIT_Common.md` autonome.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SnipeIT sur GKE Autopilot](../labs/SnipeIT_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Snipe-IT sur Google Cloud Run](SnipeIT_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Snipe-IT Common — Configuration d'application partagée](SnipeIT_Common.md) — la configuration partagée par les deux cibles de déploiement.
