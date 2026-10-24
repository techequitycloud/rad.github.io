---
title: "Calibre-Web sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Calibre-Web sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CalibreWeb_CloudRun.md @ 1665a43e sha256:921cbc75f53b -->

# Calibre-Web sur Google Cloud Run {#calibre-web-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalibreWeb_CloudRun.png" alt="Calibre-Web sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Calibre-Web est une application web propre et auto-hébergée pour parcourir, lire et
télécharger des livres électroniques à partir d'une bibliothèque Calibre existante. Elle
offre un lecteur intégré au navigateur, un flux OPDS, la gestion des utilisateurs et la
synchronisation Kobo, en plus de l'image `calibre-web` LinuxServer.io en amont. Ce
module déploie Calibre-Web sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud ; `CalibreWeb_CloudRun` est un wrapper léger qui fournit la
propre configuration de Calibre-Web (image, ports, sondes, câblage de stockage) et
transmet tout le reste directement.

Ce guide se concentre sur les services cloud utilisés par Calibre-Web et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de
service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Coût de Calibre-Web sur RAD et comparaison {#what-calibre-web-costs-on-rad-and-how-that-compares}

**Calibre-Web sur le module Cloud Run de RAD coûte environ 33 $ US par mois dans votre
propre projet Google Cloud, sans frais de licence supplémentaires** — Calibre-Web est
open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé
à **15 crédits par jour** (environ 450 par mois, soit environ 45 $ US au prix de
recharge). Ou consultez le [guide GKE](CalibreWeb_GKE.md) pour une capacité
permanente sur plusieurs pods. Si vous n'avez besoin de Calibre-Web qu'occasionnellement
— études, démo, projet de courte durée — un projet géré par RAD peut être supprimé
et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel
devient quelques dollars. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Calibre-Web est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **33 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **15 crédits par jour**, environ 450 par mois (environ 45 $ US au prix de recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un
projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont
partagés par toutes les applications du projet, de sorte qu'une deuxième application
n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 33 $ US** |

Les prix de Cloud SQL et Cloud Run/GKE sont les mêmes en africa-south1 (Johannesburg) ; la
petite VM coûte environ 10 % de plus là-bas.

- **Ce module est maintenu chaud par défaut** (`min_instance_count ≥ 1`), de sorte que le chiffre
  Cloud Run ci-dessus suppose déjà qu'il ne se met jamais à l'échelle zéro.

### Comparaison pour un serveur de livres électroniques personnel ou de petite bibliothèque {#how-it-compares-for-a-personal-or-small-library-ebook-server}

Calibre-Web n'a pas d'offre hébergée officielle — il est conçu pour fonctionner avec
votre propre bibliothèque Calibre existante, donc la comparaison réaliste est un
serveur nu :

- Un Hetzner CPX22 ou un DigitalOcean droplet (2 vCPU/4 Go, environ 24 $/mois) ou un
  GCP e2-standard-2 (2 vCPU/8 Go, environ 49 $/mois) le ferait fonctionner
  confortablement — surdimensionné pour l'empreinte de 1 vCPU/1 GiB de Calibre-Web
  ici, donc une classe d'instance plus petite et moins chère ferait tout aussi bien.
- Sur un VPS nu, vous possédez le système d'exploitation, les correctifs de sécurité et
  votre propre discipline de sauvegarde. Le module de RAD vous offre la puissance de
  calcul, Secret Manager et Cloud Monitoring déjà câblés, pour les frais de module
  plus l'utilisation de Google Cloud ci-dessus.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Calibre-Web s'exécute dans **un projet géré par RAD pour vous**, la suppression de
l'ensemble du projet — plutôt que la suppression de ce seul module — délie d'abord sa
facturation, puis demande à Google de supprimer le projet purement et simplement. Google
le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée,
rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module,
cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une :
l'ensemble du projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le
  propriétaire du projet peut demander à Google de restaurer le projet et de rattacher
  son compte de facturation, puis d'exécuter **Update** sur chaque déploiement pour
  confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette
  mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture
  jamais les frais de module à nouveau. Pour une chaîne de déploiement typique de 2 à 3
  déploiements, cela ne coûte qu'une poignée de crédits au total (environ 5 à 10
  crédits, moins de 1 $ US).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne
  gère que la facturation), le restaurer vous-même dans les 30 jours — après quoi
  Google le supprime définitivement — et franchir à nouveau le seuil d'admission du
  niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations
  d'étude/démo). Google affirme que la plupart des services sont de nouveau
  entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes
  sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression
  douce de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès
  que le projet est supprimé — même si le projet lui-même est récupérable pendant 30
  jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet)
  avant de supprimer s'il y a quelque chose à conserver ; pour une installation par
  défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et de
le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds :
  environ 79 crédits (environ 7,90 $ US) au prix de recharge, et environ 15 à 20
  minutes de temps de build (moyenne de la propre plateforme de RAD). La suppression
  ne permet d'économiser de l'argent que si Calibre-Web resterait inutilisé pendant
  environ **6 jours ou plus** — dans votre propre projet, cela représente environ 1,09
  $ US par jour, et dans un projet géré par RAD, c'est 15 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données et/ou la
  VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que lorsque rien
  d'autre dans le projet ne les utilise, donc la suppression de Calibre-Web alors
  qu'une autre application partage le projet n'économise que la partie calcul de
  Calibre-Web.
- **Conserver les données en premier.** Les sauvegardes nocturnes vont dans un bucket à
  l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière
  sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google Cloud
  pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie
  la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés
  retournent au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  interrompue et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin, le partenaire transfère le projet et les déploiements
  deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing
Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour
la fenêtre de pause/restauration et la mise en garde sur le bucket de sauvegarde ; les
prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Calibre-Web s'exécute en tant que révision unique de Cloud Run. Il n'a **pas de base
de données externe** — tout son état (la base de données de l'application, la base de
données des métadonnées de la bibliothèque Calibre, la configuration, le cache et les
journaux) réside dans des fichiers SQLite internes sous `/config`. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Calibre-Web (image LinuxServer.io) sur le port 8083, 1 vCPU / 1 GiB par défaut ; `min_instance_count = max_instance_count = 1` |
| Persistance de la configuration/bibliothèque | NFS partagé (Filestore / VM NFS) | `/config` est monté à partir du serveur NFS partagé par défaut (`enable_nfs = true`, `nfs_mount_path = "/config"`). Le bucket suffixé `storage` est toujours provisionné mais **non** monté — `enable_gcs_storage_volume` est exposé comme variable de module sur `CalibreWeb_CloudRun` et par défaut à `false`, car GCS FUSE corrompt le SQLite de Calibre-Web `app.db`. |
| Base de données | Aucune | `database_type = "NONE"` ; pas d'instance Cloud SQL, d'utilisateur ou de job `db-init` |
| Cache et file d'attente | Aucun | `enable_redis` est déclaré pour la mise en miroir des variables de fondation mais **codé en dur à `false`** dans `main.tf` quelle que soit la valeur de la variable |
| Secrets | Secret Manager | `CALIBRE_ADMIN_PASSWORD` auto-généré — provisionné mais **pas** le credential avec lequel Calibre-Web s'authentifie réellement lors de la première connexion (voir §3) |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress_settings = all`) ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé via Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Persistance GCS Fuse, pas un PVC de bloc — conception pour le développement/usage
  léger.** Contrairement à `CalibreWeb_GKE` (qui utilise un véritable volume persistant
  de bloc spécifiquement parce que le modèle de cohérence relâché de gcsfuse peut
  corrompre SQLite), ce module Cloud Run n'a aucune option de stockage de bloc —
  `/config` est soutenu par un montage **NFS** partagé par défaut (`enable_nfs = true`,
  `nfs_mount_path = "/config"`), qui fournit la sémantique POSIX dont SQLite a besoin. Le montage GCS
  Fuse à ce chemin est désactivé par défaut (`enable_gcs_storage_volume = false`) car il corrompt
  `app.db`. Le propre `module_description` du module indique explicitement que cette
  variante est "mieux adaptée au développement/usage léger" et recommande
  `CalibreWeb_GKE` avec un PVC de bloc pour la production.
- **Révision unique par défaut.** `min_instance_count = 1` et `max_instance_count = 1`. Contrairement à la
  variante GKE (où chaque réplica StatefulSet obtient son propre PVC
  indépendant), chaque instance Cloud Run monte le **même** bucket soutenu par GCS
  — donc augmenter `max_instance_count` ne duplique pas la bibliothèque comme sur GKE, mais
  cela permet à deux instances d'écrire simultanément dans les mêmes fichiers SQLite
  soutenus par gcsfuse, ce qui est dangereux. Gardez-le à 1.
- **`min_instance_count` par défaut à `1`, pas `0`.** Ce n'est
  délibérément pas une mise à l'échelle zéro — l'intention est d'éviter un démarrage
  à froid pendant que Calibre-Web charge ses index de collection/bibliothèque. Ce
  module n'expose pas `cpu_always_allocated` du tout (il n'est pas mis en miroir dans
  `variables.tf`, ni transmis dans `main.tf`), il hérite donc
  silencieusement de la valeur par défaut de la fondation App_CloudRun (`false`,
  facturation basée sur les requêtes) — le CPU de l'instance toujours chaude n'est
  toujours facturé que lorsqu'il sert réellement une requête.
- **Pas de base de données.** `database_type = "NONE"` ; il n'y a pas de job `db-init` et
  aucune des variables liées à la base de données dans ce module n'est référencée.
- **Pas de Redis.** `enable_redis` par défaut à `true` dans le
  `variables.tf` de ce module (reflétant la valeur par défaut de la fondation
  App_CloudRun) mais est **inerte** — `main.tf` passe un `enable_redis = false`
  codé en dur à l'appel de la fondation, et `redis_host`/`redis_port`/`redis_auth`
  sont déclarés mais jamais transmis.
- **Le mot de passe administrateur généré n'est pas le login fonctionnel.** L'image
  LinuxServer en amont est livrée avec un login par défaut intégré (`admin` /
  `admin123`) ; le secret Secret Manager `CALIBRE_ADMIN_PASSWORD` est provisionné pour un
  credential plus fort mais n'est pas automatiquement câblé dans le conteneur. Changez
  le mot de passe dans l'interface utilisateur de Calibre-Web lors de la première
  connexion.
- **`enable_cloudsql_volume` est codé en dur sur off.** `main.tf` passe `enable_cloudsql_volume = false` à
  la fondation quelle que soit la valeur de la variable du module, supprimant
  complètement le sidecar Cloud SQL Auth Proxy — correct, puisque Calibre-Web n'a pas
  de base de données.
- **La version de l'image est épinglée via un ARG de build spécifique à l'application.**
  Le Dockerfile lit `CALIBREWEB_VERSION` (pas le générique `APP_VERSION` que la fondation
  injecte) ; lorsque `application_version = "latest"` le build est épinglé à un `0.6.24`
  connu et fonctionnel.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Calibre-Web {#a-cloud-run--the-calibre-web-service}

Calibre-Web s'exécute en tant que service/révision unique de Cloud Run v2. Parce que
`min_instance_count = max_instance_count = 1` par défaut, il n'y a normalement qu'une seule instance en cours
d'exécution à la fois.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage et GCS Fuse — le montage `/config` {#b-cloud-storage--gcs-fuse--the-config-mount}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est toujours provisionné
lorsque `create_cloud_storage = true` (la valeur par défaut), mais par défaut il n'est **pas**
monté : `enable_gcs_storage_volume = false`, donc `/config` — le chemin où Calibre-Web
conserve ses fichiers SQLite (`app.db`, `metadata.db` de Calibre), sa
configuration, son cache et ses journaux. Le montage est contrôlé par la variable de
module `enable_gcs_storage_volume`, qui est par défaut **`false`** sur Cloud Run ; le
bucket est toujours provisionné mais laissé non monté, et `/config` est servi
par NFS à la place (voir `enable_nfs`). Des buckets/volumes
supplémentaires peuvent être déclarés via `storage_buckets` / `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

Un secret Calibre-Web est généré automatiquement et stocké dans Secret Manager :
`CALIBRE_ADMIN_PASSWORD` (une valeur aléatoire de 24 caractères, `secret-<prefix>-<app>-admin-password`),
injecté dans la révision Cloud Run en tant que variable d'environnement secrète. Il
n'est **pas** appliqué comme le véritable login Calibre-Web — voir §3.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour l'injection et la rotation des secrets.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = all`,
public). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN
et Cloud Armor peut être superposé via `enable_cloud_armor` ; les paramètres d'ingress
et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont
envoyées à Cloud Monitoring. Les tests de disponibilité sont désactivés par défaut
(`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Calibre-Web {#3-calibre-web-application-behaviour}

- **Pas de job d'initialisation par défaut.** `initialization_jobs` par défaut à
  `[]` ; Calibre-Web gère son propre stockage SQLite et n'a pas besoin
  d'amorçage de base de données (il n'y a pas de job `db-init` car
  `database_type = "NONE"`). Seuls les jobs fournis par l'utilisateur s'exécutent.
- **Pas d'étape de migration.** L'init basé sur s6 de LinuxServer en amont
  s'exécute sans modification — le Dockerfile est `FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}` sans script
  d'entrée ajouté. `image_source = "custom"` est défini uniquement pour que la fondation
  construise/mette en miroir l'image dans Artifact Registry.
- **Disposition du stockage au premier démarrage.** L'image réduit les privilèges à
  `PUID=1000`/`PGID=1000` (injectés comme variables d'environnement par
  `CalibreWeb_Common`) et conserve tout l'état sous `/config` (le volume monté
  NFS) : `app.db`, `metadata.db` de Calibre, config, cache et journaux. La
  bibliothèque de livres électroniques elle-même se trouve sous `/books` (vide
  lors de la première exécution — l'assistant de configuration intégré à l'application
  y pointe Calibre-Web).
- **`CALIBRE_ADMIN_PASSWORD` est provisionné mais non appliqué.** Le secret Secret Manager
  existe pour qu'un mot de passe fort soit disponible et pour qu'une future
  image/point d'entrée puisse le consommer — il n'est pas câblé dans le flux de
  connexion réel du conteneur. Les identifiants de première connexion intégrés de
  l'image en amont sont `admin` / `admin123`. Changez le mot de passe
  administrateur dans l'interface utilisateur de Calibre-Web immédiatement après la
  première connexion.
- **Chemin de santé.** Les sondes de démarrage et de vivacité émettent toutes deux un
  **HTTP GET `/`** (la page de connexion de Calibre-Web), qui renvoie
  `200` sans authentification requise — les sondes passent dès que le
  serveur est en service, indépendamment de tout état de connexion. Valeurs par
  défaut : démarrage `initial_delay=15s`, `period=10s`, `failure_threshold=10` ;
  vivacité `initial_delay=30s`, `period=30s`, `failure_threshold=3`. (Note : le texte de
  description de la variable `liveness_probe` dans `variables.tf` fait référence à un
  point de terminaison `/health` que Calibre-Web n'expose pas — la valeur par
  défaut configurée réelle `path` est `/` ; ne la changez
  pas en `/health`, ce qui renverrait une erreur 404.)
- **Contrainte d'écriture unique.** `min_instance_count = max_instance_count = 1` maintient exactement une
  instance écrivant dans les fichiers SQLite montés par gcsfuse à la fois. Augmenter
  `max_instance_count` ne donne **pas** à Calibre-Web une bibliothèque partagée en
  toute sécurité — cela permet à deux instances Cloud Run d'écrire
  simultanément dans les mêmes fichiers SQLite soutenus par un bucket, ce qui risque
  une corruption sous le modèle de cohérence relâché de GCS Fuse.
- **Inspecter l'exécution du job et la révision en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement (selon les balises `{{UIMeta group=N}}` dans `variables.tf`). Seuls les
paramètres spécifiques ou notables pour Calibre-Web sont listés ; toute autre entrée
est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calibreweb` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Calibre-Web` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Balise `lscr.io/linuxserver/calibre-web` utilisée comme base de build personnalisé ; `latest` est épinglée à une balise connue et fonctionnelle (`0.6.24`) au moment du build via l'ARG de build spécifique à l'application `CALIBREWEB_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Pas de mise à l'échelle zéro par défaut — évite un démarrage à froid pendant que Calibre-Web charge son index de bibliothèque. |
| `max_instance_count` | `1` | **Maintenir à 1** — voir la contrainte d'écriture unique du §3. |
| `container_port` | `8083` | Port de l'interface web de Calibre-Web. Contrairement à la variante GKE (où cette variable est inerte), cette valeur EST transmise — `calibreweb.tf` la fusionne sur le `CalibreWeb_Common` codé en dur de `8083`, de sorte qu'elle prend effet si elle est modifiée. |
| `execution_environment` | `gen2` | Gen2 requis pour le montage GCS Fuse `/config`. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | `false` codé en dur dans `main.tf` quelle que soit cette variable — Calibre-Web n'a pas de Cloud SQL. |
| `container_protocol` | `http1` | Le texte de description mentionne gRPC ; non applicable à Calibre-Web — laisser `http1`. |
| `enable_image_mirroring` | `true` | Met l'image en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour les déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |
| `service_annotations` / `service_labels` | `{}` | Annotations/étiquettes de service Cloud Run personnalisées. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut pour que l'interface web soit directement accessible. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'interface utilisateur de Calibre-Web. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets ; fusionnés avec `CalibreWeb_Common`'s `PUID=1000`, `PGID=1000`, `TZ=Etc/UTC`. |
| `secret_environment_variables` | `{}` | Carte de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer `/config` à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et scripts SQL personnalisés {#group-9--nfs-instance--custom-sql-scripts}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Non applicable — Calibre-Web n'a pas de base de données SQL. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | `""` / `""` / `false` | Non applicable. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Entrées de découverte/nommage NFS — sans objet puisque `enable_nfs = false` par défaut (Groupe 11) et Calibre-Web n'a pas de chemin de stockage basé sur NFS. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne toujours le bucket suffixé `storage`. Il n'est **pas** monté par défaut — voir `enable_gcs_storage_volume` (`false`) et §2.B. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà de celui provisionné automatiquement. |
| `enable_nfs` | `true` | NFS **est** la façon dont Calibre-Web persiste sur Cloud Run : `/config` contient un `app.db` SQLite en mode journal de restauration, que GCS FUSE ne peut pas maintenir (`BufferedWriteHandler.OutOfOrderError for object: app.db-journal`). NFS fournit la sémantique POSIX de renommage/fsync/verrouillage que FUSE ne fournit pas. Définissez `false` uniquement si vous acceptez le risque de corruption. |
| `nfs_mount_path` | `/config` | Où le volume NFS est monté — Calibre-Web y conserve tout son état (`app.db`, `metadata.db`, config, cache, journaux). Doit rester en phase avec `enable_gcs_storage_volume` : monter à la fois NFS et le volume GCS FUSE à `/config` est un conflit de double montage. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse supplémentaires. Le volume automatique `storage`→`/config` n'est fusionné que lorsque `enable_gcs_storage_volume = true`, qui est par défaut `false` sur Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (déclaré) | **Inerte** — `main.tf` code en dur `enable_redis = false` sur l'appel de la fondation quelle que soit cette variable. Calibre-Web n'a pas de dépendance Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Déclaré pour la mise en miroir des variables de fondation mais **non transmis** à App_CloudRun du tout. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `CalibreWeb_Common` ; aucune instance Cloud SQL, base de données ou utilisateur n'est créé. |
| `database_password_length` | `32` | Non référencé — aucune base de données n'existe. |
| `application_database_name` / `application_database_user` / `db_password_env_var_name` / `enable_mysql_plugins` / `enable_postgres_extensions` / `enable_auto_password_rotation` / `sql_instance_name` / `sql_instance_base_name` | divers | Tous déclarés uniquement pour la mise en miroir des variables de fondation — non applicable, puisque `database_type = "NONE"`. |
| `service_url_env_var_name` | `""` | Non lié à la base de données malgré le placement du groupe — ajoute un nom de variable d'environnement supplémentaire pour l'URL de service Cloud Run prédite à côté de `CLOUDRUN_SERVICE_URL`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation intégré — Calibre-Web gère son propre stockage SQLite. Ne fournissez des jobs que pour le chargement de données personnalisées. |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s de délai | La sonde qui est réellement appliquée (transmise via `CalibreWeb_Common`'s `config`, qui remplace l'entrée brute `startup_probe_config`). |
| `liveness_probe` | HTTP `/` 30s de délai | La sonde qui est réellement appliquée. Voir §3 pour la non-concordance du texte de description `/health`. |
| `startup_probe_config` / `health_check_config` | activé, chemin `/` | Alternances inertes — une fois que `CalibreWeb_Common` fournit `startup_probe`/`liveness_probe` via `application_config`, ces entrées brutes de niveau supérieur sont ignorées. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `organization_id` | `""` | Remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Note : ce groupe est étiqueté `group=23` dans `variables.tf`, un de plus que le
`22` utilisé par la plupart des autres modules d'application Cloud Run pour les
mêmes entrées VPC-SC/journalisation d'audit — une particularité de numérotation de
regroupement d'interface utilisateur sans effet fonctionnel.

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `calibreweb_url` | L'URL du service Cloud Run (`status.url`). Note : la description de cette sortie dans `outputs.tf` fait référence à une "API REST VPC interne (port 6333)" — ce texte est un copier-coller obsolète d'un module sans rapport (Calibre-Web n'a pas une telle API/port) ; la valeur elle-même est simplement l'URL de service normale, accessible via `ingress_settings` (public par défaut). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés, y compris le bucket `/config` monté `storage`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration fournis par l'utilisateur (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

Note : `outputs.tf` n'expose pas l'ID du secret Secret Manager pour `CALIBRE_ADMIN_PASSWORD` au
niveau supérieur (contrairement à la sortie `CalibreWeb_GKE` de `calibreweb_admin_password_secret_id`) —
récupérez-le avec `gcloud secrets list --filter="name~admin-password"` à la place.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Modèle de persistance `/config` | Utiliser `CalibreWeb_GKE` pour les bibliothèques de production | Critique | Ce module n'a pas d'option PVC de bloc ; `/config` est basé sur **NFS** par défaut (`enable_nfs = true`, `nfs_mount_path = "/config"`), ce qui évite la corruption de SQLite par gcsfuse. Ne pas définir `enable_gcs_storage_volume = true` à ce chemin — le modèle de cohérence relâchée de gcsfuse corrompt `app.db`/`metadata.db` en utilisation réelle, et cela monterait également `/config` en double. La description du module signale cette variante comme étant uniquement pour le développement/usage léger. |
| `max_instance_count` | `1` | Critique | Au-dessus de 1, plusieurs instances Cloud Run écrivent simultanément dans les **mêmes** fichiers SQLite montés par gcsfuse — un risque réel de corruption de base de données, distinct de (et à certains égards plus risqué que) le forking PVC par réplica de la variante GKE. |
| `CALIBRE_ADMIN_PASSWORD` (auto-généré) | Changer le login dans l'interface utilisateur lors de la première connexion | Élevé | Le secret généré n'est pas appliqué automatiquement ; le credential de première connexion fonctionnel est le défaut amont `admin`/`admin123` jusqu'à ce qu'il soit modifié manuellement. |
| `enable_redis` | Ignorer — inerte | Faible | `main.tf` code en dur `enable_redis = false` quelle que soit cette variable ; Calibre-Web n'a pas de dépendance Redis. |
| `enable_cloudsql_volume` | Ignorer — inerte | Faible | `main.tf` code en dur `enable_cloudsql_volume = false` ; Calibre-Web n'a pas de dépendance Cloud SQL. |
| `min_instance_count` | `1` (par défaut) | Moyen | Maintient une instance toujours chaude pour éviter un démarrage à froid pendant que Calibre-Web charge son index de bibliothèque ; ce module n'expose pas `cpu_always_allocated`, donc le CPU est toujours facturé en fonction des requêtes (par défaut de Foundation) plutôt qu'en permanence. |
| `startup_probe_config` / `health_check_config` | Ignorer — inerte une fois `application_config` défini | Faible | Ces entrées brutes sont remplacées par `CalibreWeb_Common`'s `startup_probe`/`liveness_probe`, qui est ce qui est réellement appliqué. |
| `container_port` | `8083` (garder) | Moyen | Contrairement à `CalibreWeb_GKE` (où cette variable est inerte), sur Cloud Run, elle remplace réellement le port du conteneur via un `merge()` dans `calibreweb.tf` — le modifier sans également modifier le port d'écoute de l'image amont interrompt le routage. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur de Calibre-Web et les points de terminaison OPDS/Kobo-sync sont accessibles publiquement sans protection WAF par défaut. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité de la sauvegarde `/config`. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Calibre-Web
partagée avec la variante GKE est décrite dans
**[CalibreWeb_Common](CalibreWeb_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : Calibre-Web sur Cloud Run](../labs/CalibreWeb_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Calibre-Web Common — Configuration d'application partagée](CalibreWeb_Common.md) — la configuration partagée par les deux cibles de déploiement.
