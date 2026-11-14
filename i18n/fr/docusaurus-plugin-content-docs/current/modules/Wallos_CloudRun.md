---
title: "Wallos sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Wallos sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wallos_CloudRun.md @ 40c83c3f sha256:ccc11508cf5c -->

# Wallos sur Google Cloud Run {#wallos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallos_CloudRun.png" alt="Wallos sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallos est un outil open-source auto-hébergé de suivi des abonnements et des
dépenses récurrentes, basé sur PHP 8.3 + php-fpm (sans framework MVC). Il
suit les abonnements récurrents, convertit les prix entre différentes devises,
envoie des notifications de renouvellement et prend en charge un mode
multi-utilisateur pour les foyers. Ce module déploie Wallos sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Wallos et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Wallos sur RAD, et comparaison {#what-wallos-costs-on-rad-and-how-that-compares}

**L'exécution de Wallos sur Cloud Run dans votre propre projet Google Cloud coûte environ 66,78 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une fois au moment du déploiement. Wallos n'a pas besoin de base de données gérée — il conserve tout dans un fichier SQLite intégré — donc la majeure partie de ces 66,78 $ correspond au service Cloud Run lui-même, plus une petite VM NFS/cache partagée pour sa session et son stockage SQLite. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](Wallos_GKE.md) si vous préférez l'exécuter sur Kubernetes, où ce module supprime entièrement la VM de serveur de fichiers.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Identique |
| Coût d'exécution Google Cloud | 66,78 $/mois, facturé par Google au prix catalogue | ~40 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (alwaysOn) | 47,34 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **66,78 $** |

### Comparaison {#how-it-compares}

- Wallos n'a pas de version SaaS hébergée officielle — comme la plupart des trackers d'abonnement auto-hébergés, il n'est livré que sous forme de logiciel que vous exécutez vous-même, donc le choix est vraiment "gérer un petit VPS vous-même" ou "laisser RAD gérer la même pile", et non RAD contre un abonnement.
- Avec 1 vCPU / 1 GiB avec une base de données SQLite intégrée et aucune instance Cloud SQL séparée, Wallos est suffisamment léger pour qu'une machine plus petite et moins chère que les exemples ci-dessous suffise — mais pour une comparaison équivalente : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois.
- Ce que ce prix n'inclut pas : les sauvegardes, les correctifs de sécurité, le renouvellement TLS et la page de disque plein à 2h du matin — les services gérés de RAD (Secret Manager, sauvegardes Cloud Storage et surveillance) s'en chargent pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien pendant la pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne démantèle **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Étant donné que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google affirme que la plupart
des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Wallos et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Wallos signifie le redéployer à partir de
zéro. Cela coûte 75 crédits (les frais de module ; les builds sont inclus).

La suppression ne permet d'économiser de l'argent que si Wallos reste inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Wallos, cela représente environ 4 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée — celles-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
donc copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin,
le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Wallos s'exécute comme un conteneur PHP unique sur Cloud Run v2. Il est
délibérément minimal — pas de base de données SQL, pas de cache, pas de file
d'attente — mais il exécute un véritable démon cron toujours actif, qui
détermine plusieurs des valeurs par défaut ci-dessous :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/php-fpm unique, 1 vCPU / 1 GiB par défaut ; `min = max = 1`, `cpu_always_allocated = true` |
| État persistant | NFS + Cloud Storage (GCS FUSE) | Le répertoire SQLite `/var/www/html/db` est servi depuis **NFS** (`enable_nfs = true`) — GCS FUSE ne peut pas fournir les verrous POSIX dont SQLite a besoin ; le bucket `uploads` est monté via GCS FUSE à `/var/www/html/images/uploads/logos` (logos de fournisseurs personnalisés) |
| Base de données | Aucune (SQLite intégré) | `database_type = NONE` ; aucune instance Cloud SQL n'est provisionnée ; aucune prise en charge MySQL/Postgres n'existe dans l'application |
| Cache et file d'attente | Aucun | Wallos n'utilise pas Redis |
| Secrets | Secret Manager | Aucun secret d'application généré ; les utilisateurs vivent dans la base de données SQLite |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | L'ingress par défaut est **`all`** — le service est publiquement accessible dès le départ |
| Tâches en arrière-plan | Démon cron intégré au conteneur | 8 tâches planifiées intégrées (actualisation des taux de change, notifications de renouvellement, un sondage de vérification d'e-mail toutes les 2 minutes, etc.) — non modélisé comme un job Cloud Run ; il s'exécute en continu à l'intérieur du conteneur principal |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **L'état réside sur deux volumes distincts.**
  Wallos n'a pas de base de données Cloud SQL. Ses abonnements, catégories,
  paramètres et utilisateurs sont stockés dans `/var/www/html/db/wallos.db`, monté depuis **NFS**
  (`enable_nfs = true`, `nfs_mount_path = "/var/www/html/db"`,
  `enable_gcs_db_volume = false`) ; les logos de fournisseurs personnalisés téléchargés par l'utilisateur
  résident dans `/var/www/html/images/uploads/logos` (GCS FUSE, bucket `uploads`).
  Les deux chemins sont fixes — aucune variable d'environnement ne déplace l'un ou l'autre.
  La perte ou l'effacement de l'un ou l'autre volume entraîne la perte de cet état.
- **CRITIQUE — instance unique toujours active, pas seulement un réglage de démarrage à froid.**
  `min_instance_count = max_instance_count = 1` **et** `cpu_always_allocated =
  true`. C'est une contrainte plus forte que le modèle habituel "éviter les démarrages à froid" :
  la base de données SQLite de Wallos ne prend pas en charge l'écriture multi-utilisateurs (donc `max = 1` est requis),
  et son démon cron intégré ne déclenche les tâches planifiées que lorsqu'une instance est
  effectivement en cours d'exécution avec un CPU alloué (donc `min = 1` et `cpu_always_allocated =
  true` sont tous deux requis). La mise à l'échelle à zéro arrête silencieusement toutes les tâches planifiées
  sans erreur — les notifications de renouvellement cessent simplement d'arriver.
- **La connexion par défaut est `admin` / `admin`.** Wallos initialise cette
  crédentiel au premier démarrage. Changez-la dans l'interface web
  immédiatement après le déploiement.
- **L'ingress par défaut est `all` (public).** Le service est accessible depuis
  l'internet public dès le départ. Pour le restreindre, définissez `ingress_settings = "internal"`
  (VPC-only) ou `internal-and-cloud-load-balancing`, ou placez-le derrière l'équilibreur de charge HTTPS
  (`enable_cloud_armor = true` + `application_domains`).
- **Pas de Redis, pas de job d'initialisation.** `enable_redis = false` et aucun job `db-init`
  ne s'exécute ; l'application est prête dès le démarrage du conteneur.
- **Port du conteneur 80.** Wallos sert du HTTP/1.1 simple sur le port 80
  (`container_protocol = http1`).
- **Image pré-construite.** `bellamy/wallos` est une image authentique, maintenue par un tiers,
  avec le tag "latest" (il n'y a pas d'image officielle du projet Wallos) ; aucun Dockerfile
  ni étape Cloud Build n'est utilisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Wallos {#a-cloud-run--the-wallos-service}

Wallos s'exécute comme un service Cloud Run v2 épinglé à une instance unique,
toujours allouée. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~wallos"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. NFS et Cloud Storage — état persistant {#b-nfs-and-cloud-storage--persistent-state}

Wallos n'a pas de base de données Cloud SQL. Sa base de données SQLite intégrée
(`/var/www/html/db/wallos.db`) est servie depuis le volume **NFS** partagé, tandis que ses
logos de fournisseurs téléchargés par l'utilisateur (`/var/www/html/images/uploads/logos`) résident dans un
bucket Cloud Storage monté dans le conteneur via GCS FUSE (les deux montages nécessitent
l'environnement d'exécution `gen2`).

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
  gcloud storage ls gs://<uploads-bucket>/          # user-uploaded logo files
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK.

### C. Secret Manager {#c-secret-manager}

Wallos ne génère **aucun secret d'application** — il n'y a pas de clé de
chiffrement ou de secret JWT à gérer, car tout l'état d'identité réside dans la
base de données SQLite. Secret Manager est toujours utilisé par la fondation
pour les secrets gérés par la plateforme (par exemple, les jetons CI/CD si
configurés).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~wallos"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

L'ingress du service est par défaut **`all`** — accessible depuis l'internet public dès le départ.
Pour le restreindre, définissez `ingress_settings = "internal"` (VPC-only), ou superposez
un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
politiques d'alerte facultatifs. Étant donné que le démon cron de Wallos
s'exécute en interne, son activité (ou ses échecs) de tâches planifiées n'est
visible que dans les logs du conteneur — il n'y a pas de job Cloud Run séparé à
inspecter.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Wallos {#3-wallos-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init` et pas d'instance Cloud SQL. Au premier démarrage, Wallos crée sa base de données SQLite à `/var/www/html/db/wallos.db` (sur le montage NFS) si elle n'existe pas déjà et initialise l'utilisateur par défaut `admin`/`admin`.
- **Persistance de l'état.** Les abonnements, catégories, paramètres et utilisateurs résident entièrement dans `/var/www/html/db/wallos.db`. Étant donné que ce fichier se trouve sur le volume NFS persistant, il survit aux redémarrages et aux redéploiements. Les logos de fournisseurs personnalisés persistent séparément sur le bucket `uploads`.
- **Les identifiants par défaut doivent être modifiés.** La connexion `admin`/`admin` initialisée est bien connue. Connectez-vous et modifiez le mot de passe (et idéalement le nom d'utilisateur) dans l'interface web immédiatement après le premier déploiement.
- **Contrainte d'écriture unique.** La base de données SQLite intégrée ne prend pas en charge les écritures concurrentes entre les instances sur un montage réseau partagé. Conservez `max_instance_count = 1` ; la mise à l'échelle risque de corrompre la base de données.
- **Démon cron toujours actif — non déclenché par une requête.** Les 8 tâches planifiées intégrées de Wallos (actualisation des taux de change, notifications de renouvellement, un sondage de vérification d'e-mail toutes les 2 minutes, etc.) s'exécutent en continu dans le même conteneur. C'est pourquoi `min_instance_count = 1` et `cpu_always_allocated = true` sont tous deux requis — avec une facturation basée sur les requêtes (limitée) ou une mise à l'échelle à zéro, ces tâches s'arrêteraient ou ne s'exécuteraient jamais.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent **`/`** — la page de connexion non authentifiée de Wallos. `bellamy/wallos` ne documente aucun point de terminaison `/health` dédié, il s'agit donc d'un signal de disponibilité grossier (à vérifier au premier déploiement) :
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"    # 200 once the server is up
  ```
- **Pas de Redis.** `enable_redis = false` ; Wallos est une application autonome sans file d'attente ni cache au-delà de son propre démon cron.
- **Inspecter l'environnement et les montages de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Wallos sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallos` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Wallos` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image Wallos — `bellamy/wallos:latest` est une véritable version "latest", pas un artefact de build épinglé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; couvre les workers php-fpm plus le démon cron toujours en cours d'exécution. |
| `min_instance_count` | `1` | **CRITIQUE — doit rester `1`.** Le démon cron ne se déclenche que lorsqu'une instance est en cours d'exécution. |
| `max_instance_count` | `1` | **CRITIQUE — doit rester `1`.** SQLite sur GCS FUSE ne peut pas gérer les écritures concurrentes. |
| `container_port` | `80` | Écouteur HTTP/1.1 de Wallos. |
| `container_protocol` | `http1` | Wallos sert du HTTP/1.1 simple. |
| `execution_environment` | `gen2` | Requis pour les montages GCS FUSE. |
| `enable_cloudsql_volume` | `false` | Wallos n'a pas de Cloud SQL ; laissez `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Wallos dans Artifact Registry (évite les limites de débit de Docker Hub). |
| `container_image_source` | `prebuilt` | **Doit rester transféré à la fondation** — `bellamy/wallos` n'a pas besoin d'étape de build ; le défaut propre d'App_CloudRun (`custom`) l'emporterait silencieusement autrement. |
| `cpu_always_allocated` | `true` | **CRITIQUE — doit rester `true`.** Le démon cron a besoin de CPU entre les requêtes pour exécuter réellement ses tâches planifiées. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | **Le défaut est public.** Définissez `internal` pour restreindre l'accès au VPC uniquement, ou `internal-and-cloud-load-balancing` derrière un équilibreur de charge. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Wallos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. Wallos n'en utilise aucun par défaut. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **non applicable** à Wallos (pas de base de données SQL).
Laisser les valeurs par défaut.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets Wallos `db` et `uploads` (et tout `storage_buckets` supplémentaire). |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà des buckets `db`/`uploads` auto-provisionnés. |
| `enable_nfs` | `true` | Activé par défaut — le répertoire SQLite de Wallos est servi depuis NFS, pas GCS FUSE. |
| `nfs_mount_path` | `/var/www/html/db` | Wallos code en dur son répertoire de base de données SQLite ici ; ne pas modifier. |
| `enable_gcs_db_volume` | `false` | GCS FUSE à `/var/www/html/db` interrompt le verrouillage SQLite — la base de données provient de NFS à la place. |
| `enable_gcs_uploads_volume` | `true` | Monte le bucket `uploads` à `/var/www/html/images/uploads/logos` (écritures de fichiers entiers, pas de verrouillage nécessaire). |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Le bucket `uploads` est ajouté automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable — Wallos n'a pas de base de données SQL. `database_type` est fixé à `NONE`
par `Wallos_Common`, et `database_password_length`, les entrées `db_*_env_var_name`
et la rotation des mots de passe sont transmises uniquement pour la compatibilité de la fondation.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation par défaut. Fournir des jobs uniquement pour le chargement/la migration de données personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Scheduler + Cloud Run supplémentaires — distincts des 8 tâches planifiées intégrées de Wallos. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 15s | Sonde de démarrage ; aucun point de terminaison `/health` dédié n'est documenté pour cette image. |
| `liveness_probe` | HTTP `/` délai de 30s | Sonde de vivacité sur la page de connexion non authentifiée. |
| `uptime_check_config` | désactivé, chemin `/health` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `wallos_url` | URL de l'interface web de Wallos (port 80). Interne au VPC lorsque `ingress_settings = internal`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `storage_buckets` | Buckets Cloud Storage créés (`db` et `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation (vides par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un runtime `gen1` avec des montages GCS FUSE, `min_instance_count > max_instance_count`, des délais hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `min_instance_count` | `1` | Critique | La mise à l'échelle à zéro arrête silencieusement le démon cron de Wallos — les notifications de renouvellement et toutes les autres tâches planifiées cessent de se déclencher, sans aucune erreur. |
| `max_instance_count` | `1` | Critique | >1 place des écrivains concurrents sur le fichier SQLite sur le volume NFS partagé, corrompant la base de données. |
| `cpu_always_allocated` | `true` | Critique | `false` limite le CPU à presque zéro entre les requêtes, privant le démon cron des cycles CPU dont il a besoin pour exécuter les tâches planifiées. |
| Volume NFS / bucket GCS `uploads` | Ne jamais supprimer | Critique | La base de données SQLite intégrée (NFS) et les logos personnalisés (bucket `uploads`) résident ici ; la suppression de l'un ou l'autre détruit cet état de manière permanente. |
| `admin` / `admin` (connexion initialisée) | Modifier à la première connexion | Critique | Laisser les identifiants par défaut permet à quiconque peut atteindre le service de prendre le contrôle total. |
| `ingress_settings` | `all` (ou `internal` pour restreindre) | Élevé | Le défaut `all` expose le service à l'internet public — associez-le à IAP ou Cloud Armor si ce n'est pas souhaité ; définissez `internal` pour un accès VPC uniquement. |
| `container_port` | `80` | Élevé | Wallos écoute sur le port 80 ; un port différent fait échouer la sonde de démarrage et la révision ne devient jamais prête. |
| `startup_probe` / chemin `liveness_probe` | `/` | Moyen | Aucun point de terminaison `/health` dédié n'est documenté pour `bellamy/wallos` — si l'application protège un jour son chemin racine par authentification, le chemin de la sonde doit être ajusté. |
| `container_image_source` | `prebuilt` (transféré) | Élevé | S'il n'est pas transféré, le défaut propre d'App_CloudRun (`custom`) l'emporte silencieusement et déclenche un build Kaniko à partir de la source contre une image sans Dockerfile — le déploiement échoue. |
| `enable_cloudsql_volume` | `false` | Moyen | Wallos n'a pas de Cloud SQL ; l'activation ajoute un sidecar Auth Proxy inutile. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter les volumes NFS ou GCS FUSE, donc l'état n'est pas persistant. |
| `db`/`uploads` masquage de volume | Vérifier au premier déploiement | Élevé | Si `bellamy/wallos` initialise des actifs par défaut à l'intérieur de `/var/www/html/db` ou `/var/www/html/images/uploads/logos`, le montage d'un nouveau volume vide sur ce chemin exact les masque au premier démarrage — cela n'a pas été confirmé dans un sens ou dans l'autre pendant la recherche. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Wallos partagée avec la variante GKE est décrite
dans **[Wallos_Common](Wallos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallos sur Cloud Run](../labs/Wallos_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Wallos sur GKE Autopilot](Wallos_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Wallos Common — Configuration d'application partagée](Wallos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md), [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Finance et suivi de patrimoine**.
