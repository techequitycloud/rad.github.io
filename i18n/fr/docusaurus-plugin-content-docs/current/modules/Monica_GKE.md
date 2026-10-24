---
title: "Monica sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Monica sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Monica_GKE.md @ e69407af sha256:91b6c4db192c -->

# Monica sur GKE Autopilot {#monica-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Monica_GKE.png" alt="Monica sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Monica est une application open-source de gestion des relations personnelles (PRM) — un
"CRM personnel" pour organiser la manière dont vous restez en contact avec vos amis, votre famille et
vos contacts. Ce module déploie Monica sur **GKE Autopilot** en s'appuyant sur la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Monica et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Monica sur RAD, et comment cela se compare {#what-monica-costs-on-rad-and-how-that-compares}

**L'exécution de Monica dans votre propre projet GCP coûte environ 110,13 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support -- pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD facture à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas -- voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits au fur et à mesure de l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~110,13 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~99 crédits/jour, facturé à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 GiB | 39,68 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **110,13 $** |

### Comment cela se compare {#how-it-compares}

- La version officielle hébergée de Monica coûte **9 $/mois** (90 $/an facturés annuellement) (source : https://www.monicahq.com/en/pricing), gérée par le projet lui-même sans infrastructure à exploiter -- la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD le gérant.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces -- Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est d'environ **49 $/mois** -- plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous -- mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit d'un CRM personnel à utilisateur unique, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module -- et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD commence par dissocier
sa facturation, puis demande à Google de supprimer purement et simplement le projet -- la suppression
réversible de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL,
ni aucune VM, ni la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé
pendant qu'il attend, car la facturation est déjà dissociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet
et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer
que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes -- c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module
à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours -- après cela, Google le supprime définitivement -- et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des
services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression réversible de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez
le projet -- même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé
l'application et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors
du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est
de supprimer Monica purement et simplement et de la redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus
les builds -- environ 110 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Monica reste inutilisée assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution quotidien -- par rapport au total du projet ci-dessus, cela
représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM de fichier/cache partagée ; ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie de calcul propre à cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec
celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de laboratoire, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://www.monicahq.com/en/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Monica fonctionne comme une charge de travail web PHP/Laravel (image Apache officielle). Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Apache/PHP, 1 vCPU / 2 GiB par défaut, mise à l'échelle horizontale |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Monica est fixée à MySQL |
| Stockage d'objets | Cloud Storage | Un bucket `monica-uploads` dédié pour les photos/documents de contact, plus un bucket `data` par défaut de `storage_buckets` |
| Persistance | NFS (activé par défaut) | Volume partagé pour les téléchargements `storage/` de Laravel entre les pods |
| Cache | Redis (optionnel) | Désactivé par défaut ; utilisé pour le cache/session lorsqu'il est activé |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** Le moteur de base de données provient de la couche
  d'application partagée (`MYSQL_8_0`) ; Monica ne fonctionne pas sur PostgreSQL ici.
- **L'image est l'image officielle pré-construite `monica:<version>`.** Pas d'étape Cloud Build —
  `container_image_source = "prebuilt"` tire la variante Apache de Docker Hub,
  qui sert sur le **port 80**.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager. C'est une
  clé de chiffrement Laravel et ne doit jamais être renouvelée après le premier démarrage — la renouveler
  corrompt définitivement chaque champ de base de données chiffré et invalide toutes les sessions.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image exécute
  `php artisan migrate --force` à chaque démarrage de pod, de sorte que le schéma est créé et
  mis à niveau au démarrage (après que le job `db-init` provisionne la base de données et l'utilisateur).
- **Sidecar Cloud SQL Auth Proxy sur `127.0.0.1`.** `enable_cloudsql_volume = true`
  sur GKE — l'Auth Proxy s'exécute en tant que sidecar lié à la boucle locale, donc `Monica_GKE`
  remplace `DB_HOST = 127.0.0.1`.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les fichiers téléchargés dans le
  répertoire `storage/` de Laravel soient partagés et durables entre les pods.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`, `max = 1`) — GKE
  ne prend pas en charge la mise à l'échelle à zéro, et un seul réplica convient à un CRM personnel.
- **`APP_URL` est défini à partir de l'URL de service prédite** afin que Laravel construise des
  liens absolus corrects ; mettez-le à jour avec l'URL de l'équilibreur de charge externe/domaine personnalisé après que
  l'IP soit connue.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Monica {#a-gke-autopilot--the-monica-workload}

Les pods Monica sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Le déploiement exécute un seul réplica par défaut.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Monica pour voir
  les pods et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE" <service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet). Notez que lorsque l'application est basée sur NFS, la
fondation utilise une stratégie de mise à jour `Recreate` pour éviter que deux pods ne se disputent le
volume partagé/la base de données pendant les déploiements.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Monica stocke toutes les données d'application (contacts, activités, rappels, entrées de journal,
utilisateurs) dans une instance gérée Cloud SQL pour MySQL 8.0. Les pods y accèdent en privé via
le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du
premier déploiement, le job `db-init` crée la base de données et l'utilisateur de l'application et accorde
les privilèges ; le point d'entrée du conteneur exécute ensuite les migrations Laravel.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `monica-uploads`) est provisionné
automatiquement pour les fichiers téléchargés de Monica (photos de contact, documents). Un deuxième
bucket (suffixe `data`) est également créé par défaut via l'entrée par défaut de la variable `storage_buckets`.
Le compte de service de la charge de travail se voit accorder l'accès.
Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache optionnel) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, la
fondation injecte `REDIS_HOST`/`REDIS_PORT` ; laisser `redis_host` vide alors que NFS est
activé utilise l'IP de la VM du serveur NFS comme point de terminaison Redis (la VM NFS co-héberge Redis).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected Redis env in the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : la
**`APP_KEY`** Laravel (utilisée pour le chiffrement AES-256-CBC des colonnes chiffrées et pour
la signature des sessions/cookies). Il est livré dans le pod via le pilote CSI du Secret Store. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### F. Réseau et Ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Monica {#3-monica-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  la base de données et l'utilisateur de l'application, accorde les privilèges et vérifie que l'utilisateur de l'application
  peut se connecter (en réchauffant également le cache d'authentification `caching_sha2_password` de MySQL 8). Le
  job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image officielle de Monica
  exécute `php artisan migrate --force` à chaque démarrage de pod — il n'y a pas de job de migration séparé.
  Le schéma est créé au premier démarrage (après `db-init`) et mis à niveau
  automatiquement lorsque vous mettez à jour `application_version`.
- **`APP_KEY` est immuable après le premier démarrage.** Il est généré une fois et écrit dans
  Secret Manager. Le modifier corrompt définitivement tous les champs de base de données chiffrés et
  invalide chaque session — ne le faites pivoter que pendant une fenêtre de maintenance planifiée avec un
  plan de rechiffrement complet des données.
- **Configuration initiale dans l'interface utilisateur.** Monica n'a **pas de identifiants par défaut**. Accédez à l'URL
  de l'équilibreur de charge externe : un visiteur non authentifié est redirigé vers la
  page d'inscription/configuration. Le premier compte que vous créez devient l'administrateur.
  Inscrivez-vous avec `admin@techequity.cloud` pour les déploiements RAD.
- **Les téléchargements de fichiers sont partagés entre les pods.** Les photos/documents téléchargés se trouvent sous
  le répertoire `storage/` de Laravel. NFS est activé par défaut afin que le volume soit partagé et durable ;
  le bucket GCS `monica-uploads` est également provisionné. Les déploiements basés sur NFS utilisent la
  stratégie `Recreate` pour éviter que deux pods ne se disputent le même volume.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur `/` (passe dès qu'Apache
  lie le port) et la sonde de vivacité est **HTTP** `GET /` (la page d'accueil de Monica
  renvoie `200`). Prévoyez une fenêtre généreuse pour le premier démarrage d'Apache et la
  première `php artisan migrate --force`.
- **Mettre à jour `APP_URL` une fois l'IP connue.** L'URL prédite est injectée au moment de la planification ;
  définissez `APP_URL` sur l'URL de l'équilibreur de charge externe ou du domaine personnalisé via
  `environment_variables` afin que les liens absolus et les redirections se résolvent correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Monica sont listés ; toutes les autres entrées sont héritées
de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `monica` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Monica ; épingler à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Tire l'image officielle `monica` directement — ne pas changer en `custom`. |
| `container_port` | `80` | L'image Apache de Monica écoute sur le port 80. |
| `cpu_limit` | `1000m` | CPU par pod (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `min_instance_count` | `1` | GKE n'a pas de mise à l'échelle à zéro ; garder à 1 pour un CRM personnel. |
| `max_instance_count` | `1` | Un seul réplica est suffisant. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy ; `DB_HOST` est remplacé par `127.0.0.1`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut — volume partagé et durable pour les téléchargements `storage/` de Laravel entre les pods. |
| `nfs_mount_path` | `/var/www/html/storage` | Chemin de montage à l'intérieur du conteneur — Monica persiste les téléchargements et les données d'exécution sous le répertoire `storage/` de Laravel. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `monica-uploads` (du module Common) plus les buckets dans `storage_buckets`. Définir `false` pour ignorer toute création de bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner — la valeur par défaut crée un deuxième bucket `data` à côté de `monica-uploads`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse optionnels via le pilote CSI. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (de Common) | Fixé à MySQL 8.0. |
| `application_database_name` | `monica` | Nom de base de la base de données (préfixé par le locataire). Immuable après le premier déploiement. |
| `application_database_user` | `monica` | Nom de base de l'utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer pour ajouter un support de cache/session ; injecte `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Monica. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`monica-uploads` et `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un runtime `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites, des valeurs `quota_memory_*` entières brutes, un type de charge de travail `Deployment` avec `stateful_pvc_enabled`. Une configuration invalide fait échouer la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter corrompt définitivement chaque champ de base de données chiffré et invalide toutes les sessions. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `MYSQL_8_0` | Critique | Monica est une application MySQL ; un moteur non-MySQL rompt le pilote et les migrations. |
| `enable_nfs` | `true` | Élevé | La désactivation entraîne la perte du volume `storage/` partagé — les photos/documents téléchargés ne sont pas partagés entre les pods et sont perdus lors de la recréation du pod. |
| `container_image_source` | `prebuilt` | Élevé | Définir `custom` fait en sorte qu'App_GKE tente une construction sans Dockerfile. |
| `container_port` | `80` | Élevé | L'image Apache écoute sur le port 80 ; un port non concordant fait échouer la sonde de démarrage. |
| `enable_cloudsql_volume` | `true` (GKE) | Élevé | Le sidecar Auth Proxy fournit `127.0.0.1:3306` ; le désactiver rompt la connectivité MySQL. |
| `DB_HOST` (auto-défini `127.0.0.1`) | laisser tel quel | Élevé | Sur GKE, le sidecar proxy est sur la boucle locale ; un hôte différent ne peut pas atteindre MySQL. |
| `APP_URL` | URL de l'équilibreur de charge externe/domaine | Élevé | Une URL erronée rompt les liens absolus et la redirection `/` → configuration/inscription. |
| `min_instance_count` | `1` | Moyen | GKE exige min ≥ 1 ; un seul réplica convient à un CRM personnel. |
| `memory_limit` | `2Gi` | Moyen | Réduire trop les risques de PHP OOM lors des migrations au premier démarrage et des pages lourdes. |
| `enable_redis` | désactivé sauf si nécessaire | Faible | Support de cache/session optionnel ; lorsqu'il est activé sans hôte et NFS désactivé, le point de terminaison Redis est vide. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Monica
partagée avec la variante Cloud Run est décrite dans
**[Monica_Common](Monica_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Monica sur GKE Autopilot](../labs/Monica_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Monica sur Google Cloud Run](Monica_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Monica Common — Configuration d'application partagée](Monica_Common.md) — la configuration partagée par les deux cibles de déploiement.
