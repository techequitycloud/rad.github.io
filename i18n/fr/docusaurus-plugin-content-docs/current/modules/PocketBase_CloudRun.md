---
title: "PocketBase sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de PocketBase sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PocketBase_CloudRun.md @ e69407af sha256:43b37da2a253 -->

# PocketBase sur Google Cloud Run {#pocketbase-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PocketBase_CloudRun.png" alt="PocketBase sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PocketBase est un backend open source en un seul fichier — une base de données SQLite
embarquée avec une API REST en temps réel, une authentification intégrée, un stockage de
fichiers et un tableau de bord d'administration. Ce module déploie PocketBase sur
**Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par PocketBase et sur la manière
de les explorer et de les exploiter depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à chaque application Cloud Run — identité de
service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte PocketBase sur RAD et comment cela se compare {#what-pocketbase-costs-on-rad-and-how-that-compares}

**L'exécution de PocketBase dans votre propre projet Google Cloud coûte environ 19,14 $ US/mois en infrastructure, plus des frais de module uniques de 40 crédits RAD** (dimensionnés à 1 vCPU / 1 GiB sur une instance Cloud Run chaude toujours active). RAD facture les frais de module une seule fois, au moment du déploiement — jamais plus lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la marge de RAD — environ 9 crédits/jour — et les frais de module sont inférieurs de 10 %, à 36 crédits. Voir "Mettre en pause gratuitement" ci-dessous pour savoir comment un déploiement PocketBase géré par RAD peut être arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin. (ou voir le [guide GKE](PocketBase_GKE.md) si vous avez besoin de Kubernetes)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits (une fois) | 36 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~19,14 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~9 crédits/jour, mesurés à l'heure au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| **Total** | **19,14 $** |

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement comparable, pour ce projet open source exact, donc la comparaison honnête est un simple serveur autogéré : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un Droplet DigitalOcean 2 vCPU/4 Go (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte propre de cette application (1 vCPU ou moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes, donc une simple machine autogérée dimensionnée pour correspondre coûterait moins cher que les chiffres ci-dessus — mais vous seriez toujours responsable de chaque correctif, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour un montant en dollars identique ou similaire, c'est une base de données gérée, des identifiants conservés dans Secret Manager, une surveillance et une mise à jour en un clic, dont aucun n'est offert gratuitement par un VPS nu.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du système d'exploitation/de la base de données, effectuez et testez les sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret Manager et la surveillance gèrent les trois pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite lorsqu'elle est
mise en pause. La suppression d'un projet géré par RAD délie d'abord sa facturation, puis
demande à Google de supprimer le projet lui-même — la suppression logique récupérable de
Google pendant 30 jours. Contrairement à la suppression d'un seul module, cela ne détruit
pas la base de données, une VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et comme la facturation est déjà déliée, rien n'est facturé pendant
qu'il attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet — demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien
n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà là :
c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les
frais de module à nouveau. L'ensemble de la restauration ne coûte qu'une poignée de crédits
(moins de 1 $ US) en temps de build pour une chaîne de déploiements typique. Ce qu'il faut :
vous devez être propriétaire du projet (pas seulement faire gérer sa facturation par RAD),
vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime
définitivement — et la restauration est admise comme la création d'un nouveau projet, donc
votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour
le palier sandbox que la plupart des études et démos utilisent). Google indique que la
plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une
restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, de sorte que le bucket de sauvegarde est très probablement
supprimé dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors
du projet) avant de le supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **propre projet** (ou un projet géré par RAD au-delà de sa fenêtre
de restauration de 30 jours), consiste à supprimer PocketBase purement et simplement et à
le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module plus les
builds — environ **43-46 crédits** au total pour ce module.

La suppression ne permet d'économiser de l'argent que si PocketBase restait inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût
d'exécution — pour ce module, cela représente environ 7 jours ou plus d'inactivité,
basé sur son propre coût d'exécution de 19,14 $ US/mois ci-dessus. La majeure partie de
ce coût d'exécution est généralement la base de données et toute VM de fichier/cache
partagée, et elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise,
donc la suppression de cette application seule n'économise que sa propre part de calcul
si quelque chose d'autre partage le projet.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière
sauvegarde avant de la supprimer si vous voulez la conserver.

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

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ;
[radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et
les estimations de crédits quotidiens ; [Resource Manager : supprimer et restaurer des
projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les
mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

PocketBase s'exécute comme un seul binaire Go autonome sur Cloud Run v2. Le déploiement
connecte un ensemble délibérément minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 1 vCPU / 1 GiB par défaut, écoute sur le port **8090** |
| Base de données | **SQLite embarquée** | Pas de Cloud SQL — la base de données réside dans `/pb_data`, persistée sur Cloud Storage |
| Stockage persistant | Cloud Storage (GCS FUSE) | Un bucket de données dédié monté à `/pb_data` (gen2 requis) |
| Cache et file d'attente | **Aucun** | PocketBase n'utilise pas Redis ; `enable_redis = false` |
| Secrets | Secret Manager | Aucun auto-généré — l'authentification réside dans SQLite ; secrets facultatifs pour votre propre usage |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress = all`) ; LB HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **La base de données est SQLite embarquée — il n'y a pas de Cloud SQL.** PocketBase
  stocke chaque enregistrement, jeton d'authentification et fichier téléchargé sous
  `/pb_data`, qui est monté à partir d'un bucket Cloud Storage via GCS FUSE. Perdre ou
  effacer ce bucket entraîne la perte de toutes les données.
- **`max_instance_count` doit rester à `1`.** SQLite est une base de données à un seul
  rédacteur et le montage FUSE `/pb_data` n'est pas sûr pour les rédacteurs
  concurrents. L'exécution de plus d'une instance corrompt la base de données. C'est
  pourquoi les valeurs min et max sont toutes deux par défaut à `1`.
- **`min_instance_count = 1` par défaut** (pas de mise à l'échelle à zéro). Maintenir une
  instance chaude évite la latence de démarrage à froid et maintient le rédacteur SQLite
  unique actif. Les démarrages à froid de Cloud Run ajouteraient autrement une latence
  de première requête après l'inactivité.
- **Le compte administrateur est créé de manière interactive lors de la première
  exécution à `/_/`.** Aucun mot de passe administrateur n'est injecté.
  Quiconque atteint `/_/` en premier crée le super-utilisateur — ouvrez l'URL
  d'administration et créez-le **immédiatement** après le déploiement.
- **Aucun secret n'est auto-généré.** PocketBase émet et stocke toute l'authentification
  elle-même ; Secret Manager n'est utilisé que si vous ajoutez vos propres secrets
  (SMTP, clés de sauvegarde externes, etc.).
- **Ingress public par défaut.** `ingress_settings = "all"` — PocketBase est une application web
  orientée utilisateur (interface d'administration à `/_/` plus une API REST
  publique). L'activation d'IAP bloquera le trafic public de l'API et de l'application.
- **NFS et Redis sont désactivés.** PocketBase n'a besoin ni de l'un ni de l'autre ;
  tout l'état est le volume unique `/pb_data`.
- **L'environnement d'exécution gen2** est requis pour le montage GCS FUSE `/pb_data`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service PocketBase {#a-cloud-run--the-pocketbase-service}

PocketBase s'exécute en tant que service Cloud Run v2 écoutant sur le port **8090**.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs. Maintenez-le à une seule instance (voir §3).

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

### B. Base de données — SQLite embarquée (pas de Cloud SQL) {#b-database--embedded-sqlite-no-cloud-sql}

Il n'y a **pas d'instance Cloud SQL**. La base de données de PocketBase est un ensemble de
fichiers SQLite à l'intérieur de `/pb_data`, qui est monté à partir du bucket de données
Cloud Storage. Pour inspecter ou sauvegarder la base de données, vous travaillez avec le
contenu du bucket, pas un point de terminaison SQL.

- **Console :** Cloud Storage → Buckets → le bucket de données PocketBase → `pb_data/`.
- **CLI :**
  ```bash
  # Confirm the service reports NO Cloud SQL attachment:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.metadata.annotations)'
  # Copy the SQLite database out of the bucket for an offline backup / inspection:
  gcloud storage cp gs://<data-bucket>/data.db ./pb_data-backup.db
  ```

### C. Cloud Storage — le volume `/pb_data` {#c-cloud-storage--the-pb_data-volume}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement et
monté à `/pb_data` via GCS FUSE. Il contient la base de données SQLite, les fichiers
téléchargés et les paramètres — tout ce que PocketBase persiste.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  gcloud storage du -s gs://<data-bucket>/        # total data size
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK. Le bucket
applique la prévention de l'accès public.

### D. Secret Manager {#d-secret-manager}

**Aucun secret n'est auto-généré** pour PocketBase — son authentification est stockée
dans SQLite. Secret Manager n'est utilisé que si vous injectez vos propres secrets (par
exemple, les identifiants SMTP ou les clés de sauvegarde externes) via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~pocketbase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress = all`), ce qui permet
l'accès public dont l'application et l'API de PocketBase ont besoin. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run
sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des
stratégies d'alerte facultatives.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PocketBase {#3-pocketbase-application-behaviour}

- **Pas de job de base de données au premier déploiement.** PocketBase crée sa propre
  base de données SQLite, ses collections système et son schéma lors du premier
  démarrage sous `/pb_data`. Il n'y a pas de job `db-init` à exécuter ou à
  surveiller.
- **Les migrations s'appliquent automatiquement au démarrage.** PocketBase exécute
  toutes les migrations de schéma en attente lors de chaque démarrage, de sorte que la
  mise à niveau de `application_version` applique les modifications de schéma sans étape de
  migration distincte. Sauvegardez toujours `/pb_data` avant une mise à jour de
  version.
- **Le super-utilisateur administrateur est créé lors de la première exécution.** Ouvrez
  `https://<service-url>/_/` juste après le déploiement et créez le compte administrateur. Tant
  qu'il n'existe pas, quiconque atteint `/_/` peut le revendiquer et
  posséder l'instance — traitez cela comme une étape de première exécution sensible au
  temps.
- **Le volume `/pb_data` est le seul état durable.** La base de données SQLite, les
  fichiers téléchargés et les paramètres y résident tous. Protégez le bucket de données
  en conséquence ; sauvegardez-le régulièrement.
- **Instance unique par conception.** SQLite sérialise les écritures via un seul fichier
  de base de données et le montage GCS FUSE est à un seul rédacteur. `min_instance_count` et
  `max_instance_count` sont tous deux par défaut à `1` ; n'augmentez pas
  `max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`, le
  point de terminaison public non authentifié de PocketBase (renvoie HTTP `200` /
  `{"code":200,"message":"API is healthy."}`). Le premier démarrage est rapide car il n'y a pas de base de
  données externe à attendre.
- **Vérifier l'état d'exécution :**
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/api/health"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour PocketBase sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `pocketbase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image ; `latest` se résout en ARG de build `0.22.21` épinglé. Épinglez une version explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU est confortable pour le binaire Go unique. |
| `memory_limit` | `1Gi` | Mémoire par instance ; PocketBase est léger (512 Mo sont souvent suffisants). |
| `min_instance_count` | `1` | Garder à 1 — évite les démarrages à froid et maintient le rédacteur SQLite unique actif. |
| `max_instance_count` | `1` | **Ne pas augmenter.** SQLite + GCS FUSE sont à rédacteur unique ; >1 corrompt les données. |
| `container_port` | `8090` | PocketBase écoute sur le port 8090 (API HTTP + interface d'administration). |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE `/pb_data`. |
| `enable_cloudsql_volume` | `false` | Désactivé de force — PocketBase n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir/construire l'image PocketBase dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public pour l'interface utilisateur de l'application et l'API REST. `internal` restreint au VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque l'API publique et l'interface d'administration.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires pour le conteneur (PocketBase n'en a pas besoin pour le premier démarrage). |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager (uniquement pour vos propres secrets). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données `/pb_data` et tout `storage_buckets` supplémentaire. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `enable_nfs` | `false` | NFS est désactivé — PocketBase persiste tout dans le bucket `/pb_data`. |
| `gcs_volumes` | `[]` | Volumes GCS FUSE supplémentaires (le volume `/pb_data` est ajouté automatiquement). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — PocketBase utilise une base de données SQLite embarquée ; aucun Cloud SQL n'est créé. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai de 15s | Sonde de démarrage ; rapide car il n'y a pas de base de données externe à attendre. |
| `liveness_probe` | HTTP `/api/health`, délai de 30s | Sonde de vivacité contre le point de terminaison de santé public. |
| `uptime_check_config` | désactivé, chemin `/api/health` | Vérification de disponibilité de Cloud Monitoring. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `pocketbase_url` | URL du service pour l'API HTTP PocketBase + interface d'administration (port 8090). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `/pb_data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (aucun par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les
> combinaisons* au moment de la planification — un `container_port` invalide, un runtime
> `gen1` avec des montages GCS FUSE, IAP sans identités autorisées, des valeurs de
> sonde ou de rétention hors plage. Une configuration invalide échoue la **planification**
> avec une erreur claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critique | SQLite + GCS FUSE sont à rédacteur unique ; plus d'une instance corrompt la base de données. |
| Le bucket de données `/pb_data` | Ne jamais supprimer ; sauvegarder | Critique | Le bucket **est** la base de données et le stockage de fichiers — le supprimer ou l'effacer détruit toutes les données. |
| `database_type` | `NONE` (fixe) | Critique | PocketBase n'a pas de base de données externe ; la sélection d'un moteur provisionne un Cloud SQL inutilisé et ne modifie pas l'emplacement des données. |
| Compte administrateur à `/_/` | Créer immédiatement après le déploiement | Critique | Tant que le super-utilisateur n'existe pas, quiconque atteint `/_/` peut le revendiquer et posséder l'instance. |
| Mise à jour `application_version` | Sauvegarder `/pb_data` en premier | Élevé | PocketBase auto-migre le schéma au démarrage ; une mise à niveau interrompue peut laisser la base de données SQLite en pleine migration. |
| `execution_environment` | `gen2` | Élevé | gen1 ne peut pas monter le volume GCS FUSE `/pb_data` ; le service démarre sans données persistantes. |
| `ingress_settings` | `all` | Élevé | `internal` bloque l'interface utilisateur publique de l'application et l'API REST depuis Internet. |
| `enable_iap` | Uniquement pour les déploiements privés | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les clients API publics et l'interface d'administration. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid et interrompt brièvement le rédacteur SQLite unique entre les requêtes. |
| `memory_limit` | `1Gi` (512 Mo min) | Faible | PocketBase est léger ; le surprovisionnement n'ajoute que des coûts. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
PocketBase partagée avec la variante GKE est décrite dans
**[PocketBase_Common](PocketBase_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : PocketBase sur Cloud Run](../labs/PocketBase_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PocketBase sur GKE Autopilot](PocketBase_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [PocketBase Common — Configuration d'application partagée](PocketBase_Common.md) — la configuration partagée par les deux cibles de déploiement.
