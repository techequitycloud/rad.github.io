---
title: "PhotoPrism sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de PhotoPrism sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PhotoPrism_CloudRun.md @ e69407af sha256:c633675ab8ce -->

# PhotoPrism sur Google Cloud Run {#photoprism-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhotoPrism_CloudRun.png" alt="PhotoPrism sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PhotoPrism est une application auto-hébergée de gestion de photos et de vidéos
basée sur l'IA : elle parcourt, organise et partage une bibliothèque multimédia
personnelle avec un étiquetage automatique, une reconnaissance faciale et une
recherche textuelle/visuelle, le tout servi à partir d'un seul binaire Go avec
une base de données SQLite intégrée — pas de moteur de base de données externe,
pas de processus de travail séparé. Ce module déploie PhotoPrism sur **Cloud Run
v2** en mode **SQLite intégré, adossé à GCS** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par PhotoPrism et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications Cloud Run — identité de service, entrée et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte PhotoPrism sur RAD, et comment cela se compare {#what-photoprism-costs-on-rad-and-how-that-compares}

**L'exécution de PhotoPrism dans votre propre projet Google Cloud coûte environ
25,72 $ US/mois en infrastructure, plus des frais de module uniques de 75
crédits RAD** (dimensionnés à 1 vCPU / 2 GiB sur une instance Cloud Run chaude
toujours active). RAD facture les frais de module une seule fois, au moment du
déploiement — jamais plus lors d'une mise à jour — plus le temps de build
mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre
propre compte de facturation au prix catalogue de Google. Sur un projet
**géré par RAD**, les mêmes ressources sont mesurées toutes les heures en
crédits au prix catalogue majoré de la marge de RAD — environ 12 crédits/jour —
et les frais de module sont inférieurs de 10 %, à 67,50 crédits. Voir
"Mettez-le en pause gratuitement" ci-dessous pour savoir comment un déploiement
PhotoPrism géré par RAD peut être arrêté, sans frais de fonctionnement, jusqu'à
ce que vous en ayez à nouveau besoin. (ou consultez le [guide GKE](PhotoPrism_GKE.md)
si vous avez besoin de Kubernetes)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Article | Propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits (une fois) | 67,50 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût de fonctionnement Google Cloud | ~25,72 $/mois, facturés à votre propre compte de facturation au prix catalogue de Google | ~12 crédits/jour, mesurés toutes les heures au prix catalogue + marge de RAD |

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource | $/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (chaud) | 19,72 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 |
| **Total** | **25,72 $** |

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement
  comparable, pour ce projet open-source exact, donc la comparaison honnête est
  un serveur auto-géré nu : Hetzner CPX22 (2 vCPU/4GB, ~24 $/mois), un Droplet
  DigitalOcean 2 vCPU/4GB (~24 $/mois), ou un GCP Compute Engine e2-standard-2
  (2 vCPU/8GB, ~49 $/mois).
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est
  généralement pas le cas. Ce que RAD ajoute pour le même montant ou un montant
  similaire est une base de données gérée, des identifiants conservés par Secret
  Manager, une surveillance et une mise à jour en un clic, dont aucun n'est
  offert gratuitement par un VPS nu.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du
  système d'exploitation/de la base de données, effectuez et testez les
  sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret
  Manager et la surveillance gèrent les trois pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option principale sur un projet **géré par RAD**, et elle est gratuite
pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer le projet lui-même — la
suppression logique récupérable de 30 jours de Google. Contrairement à la
suppression d'un seul module, cela ne détruit pas la base de données, aucune VM
ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé pendant
qu'il attend.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet
— demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes :
il s'agit d'une vérification, pas d'une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. L'ensemble de la restauration ne
coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build pour une
chaîne de déploiements typique. Ce qu'il faut : vous devez être propriétaire du
projet (pas seulement faire gérer sa facturation par RAD), vous devez le
restaurer vous-même dans les 30 jours — après cela, Google le supprime
définitivement — et la restauration est admise comme la création d'un nouveau
projet, de sorte que votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des études et
démos utilisent). Google indique que la plupart des services sont à nouveau
pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et la suppression logique de Cloud Storage est
explicitement désactivée pour ce bucket, de sorte que le bucket de sauvegarde
est très probablement supprimé dès que vous supprimez le projet — même si le
projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce
déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde
(vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour
une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **propre projet** (ou un projet géré par RAD au-delà de
sa fenêtre de restauration de 30 jours), est de supprimer PhotoPrism
complètement et de le redéployer plus tard. Un redéploiement coûte à nouveau les
frais de module plus les builds — environ **78-81 crédits** au total pour ce
module.

La suppression ne permet d'économiser de l'argent que si PhotoPrism reste
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût de fonctionnement — pour ce module, cela représente
environ 10 jours ou plus d'inactivité, basé sur son propre coût de
fonctionnement de 25,72 $ US/mois ci-dessus. La majeure partie de ce coût de
fonctionnement est généralement la base de données et toute VM de fichier/cache
partagée, et ils ne s'arrêtent que si rien d'autre dans le projet ne les
utilise, de sorte que la suppression de cette application seule n'économise que
sa propre part de calcul si quelque chose d'autre partage le projet.

**Conservez les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la
dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ; [Resource
Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

PhotoPrism s'exécute comme un conteneur binaire Go unique sur Cloud Run v2,
épinglé à une seule instance. Le déploiement relie un ensemble délibérément
restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur binaire Go sur le port 2342, 1 vCPU / 1 GiB par défaut ; **toujours une seule instance** (`min=1`, `max=1`) — pas de mise à l'échelle à zéro, pas de mise à l'échelle horizontale |
| Base de données | Aucune | SQLite intégré (`PHOTOPRISM_DATABASE_DRIVER=sqlite`) — aucune instance Cloud SQL n'est provisionnée par défaut |
| Stockage persistant | Cloud Storage (GCS FUSE) | La **seule** couche de persistance sur cette variante — l'intégralité du répertoire de données `/photoprism` (base de données SQLite, cache, originaux, importations) est montée à partir d'un seul bucket GCS via GCS FUSE |
| Secrets | Secret Manager | `PHOTOPRISM_ADMIN_PASSWORD` généré automatiquement |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut (`ingress_settings = "all"`) ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est jamais provisionnée par défaut.** `database_type`
  par défaut à `"NONE"` et `enable_cloudsql_volume` est codé en dur `false` dans
  `main.tf` — PhotoPrism gère son propre fichier SQLite sous `/photoprism/storage`.
  Contrairement à la variante GKE (qui code en dur `database_type = "NONE"`
  inconditionnellement), **ce module Cloud Run transmet toujours `var.database_type` à la
  fondation** — voir le piège au §6 si vous le modifiez de `NONE`.
- **GCS FUSE est le seul mécanisme de persistance — il n'y a pas d'option
  block-PVC sur Cloud Run.** La description du module l'indique clairement :
  *"Ce module déploie PhotoPrism sur Cloud Run en mode SQLite intégré avec un
  volume de données adossé à GCS. Pour les bibliothèques multimédias de
  production nécessitant un volume de blocs durable, utilisez PhotoPrism_GKE
  (block PVC)."* Le modèle d'écriture/cohérence de gcsfuse est plus faible
  qu'un véritable périphérique de blocs pour les fichiers WAL/journal de SQLite
  ; l'épinglage à instance unique (ci-dessous) est ce qui le maintient en
  sécurité plutôt que toute garantie de verrouillage de gcsfuse lui-même.
- **Instance unique, toujours.** `min_instance_count = 1` et `max_instance_count = 1` sont tous deux
  par défaut et décrits comme fixes — PhotoPrism sert une bibliothèque SQLite
  partagée à partir d'un volume inscriptible ; l'exécution de deux instances
  contre le même bucket monté par gcsfuse risque d'endommager la base de données
  et l'index.
- **Redis est désactivé de force, quelle que soit la variable.** La valeur par
  défaut de la fondation App_CloudRun pour `enable_redis` est `true`, mais
  `main.tf` code en dur `enable_redis = false` inconditionnellement — PhotoPrism n'a
  pas d'intégration Redis et aucun `REDIS_HOST`/`REDIS_PORT` n'est jamais injecté.
- **Le mot de passe administrateur est généré automatiquement.** Un mot de
  passe de 24 caractères (sans caractères spéciaux) est créé et stocké dans
  Secret Manager, puis injecté comme variable d'environnement secrète
  `PHOTOPRISM_ADMIN_PASSWORD` ; le nom d'utilisateur est la variable simple `admin_username`
  (par défaut `admin`).
- **Le build d'image personnalisé est un miroir mince, pas une logique
  d'application.** Le build enveloppe l'image amont `photoprism/photoprism`
  (`FROM photoprism/photoprism:${PHOTOPRISM_VERSION}`) afin que la fondation puisse la refléter dans Artifact Registry ;
  l'ARG de build spécifique à l'application est `PHOTOPRISM_VERSION` (pas le générique
  `APP_VERSION`), épinglé à `240915` lorsque `application_version = "latest"`.
- **L'environnement d'exécution `gen2` est obligatoire.** Les volumes GCS
  FUSE nécessitent `execution_environment = "gen2"` (la valeur par défaut) ; passer à `gen1`
  casse complètement le montage du stockage.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  le point de terminaison non authentifié `GET /api/v1/status`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service PhotoPrism (instance unique) {#a-cloud-run--the-photoprism-service-single-instance}

PhotoPrism s'exécute comme un service Cloud Run v2 épinglé à une seule instance
(`min_instance_count = max_instance_count = 1`) — il n'y a pas de plage d'autoscaling à régler. Chaque déploiement
crée une révision immuable ; le trafic peut toujours être réparti entre les
révisions pour des déploiements échelonnés, mais l'exécution simultanée de deux
révisions servant du trafic en direct risque d'avoir deux rédacteurs contre le
même fichier SQLite monté par gcsfuse.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume persistant GCS FUSE {#b-cloud-storage--the-gcs-fuse-persistent-volume}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage_buckets` `storage`) est
provisionné automatiquement et monté dans le conteneur en tant que volume **GCS
FUSE** à `/photoprism` (entrée `gcs_volumes` `name = "storage"`, `mount_path = "/photoprism"`,
non en lecture seule). Ce montage unique couvre tout ce que PhotoPrism
persiste : `/photoprism/storage` (base de données SQLite + cache de vignettes),
`/photoprism/originals` (médias importés/indexés) et `/photoprism/import` (importations
en attente). Des buckets supplémentaires peuvent être déclarés via `storage_buckets` ;
des montages GCS FUSE supplémentaires via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/photoprism/originals/   # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et
CMEK.

### C. Secret Manager {#c-secret-manager}

Un secret est généré automatiquement : le mot de passe administrateur PhotoPrism
(`secret-<prefix>-photoprism-admin-password`), une chaîne aléatoire de 24 caractères sans caractères
spéciaux, injectée comme `PHOTOPRISM_ADMIN_PASSWORD`. Il n'y a pas de mot de passe de base
de données à gérer car aucune instance Cloud SQL n'existe par défaut.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings =
"all"`),
ce qui permet un accès direct à l'interface utilisateur web. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'entrée et le contrôle de sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneur sont acheminés vers Cloud Logging ; les métriques
Cloud Run sont acheminées vers Cloud Monitoring, avec une vérification de
disponibilité facultative (désactivée par défaut) et des politiques d'alerte
personnalisées.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PhotoPrism {#3-photoprism-application-behaviour}

- **Pas de job d'initialisation/création de base de données par défaut.**
  `initialization_jobs` par défaut à `[]` — il n'y a pas de base de données
  externe à amorcer. PhotoPrism crée et migre son propre schéma SQLite au
  premier démarrage, directement sur le volume monté par gcsfuse.
- **Disposition du stockage.** Tout l'état se trouve sous le répertoire monté
  unique `/photoprism` : `PHOTOPRISM_STORAGE_PATH=/photoprism/storage` (base de données SQLite + cache),
  `PHOTOPRISM_ORIGINALS_PATH=/photoprism/originals` (médias importés/indexés), `PHOTOPRISM_IMPORT_PATH=/photoprism/import` (importations
  en attente).
- **Compte administrateur.** `PHOTOPRISM_ADMIN_USER` est la variable simple `admin_username`
  (par défaut `admin`) ; `PHOTOPRISM_ADMIN_PASSWORD` est la valeur Secret Manager
  générée automatiquement, injectée comme variable d'environnement secrète.
  `PHOTOPRISM_AUTH_MODE = "password"` est défini explicitement. Récupérez le mot de passe de Secret
  Manager avant la première connexion.
- **URL du site.** `PHOTOPRISM_SITE_URL` est vide par défaut — PhotoPrism le tolère et
  revient à l'hôte de la requête, mais définissez `site_url` sur l'URL Cloud
  Run déployée pour des liens absolus et des URL de vignettes correctement
  générés.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `GET /api/v1/status`, un point de terminaison non authentifié qui renvoie 200 une
  fois que le serveur HTTP est opérationnel et que l'index SQLite est prêt. La
  sonde de démarrage autorise environ 15s + 10×10s (~1 minute 55 secondes) après
  le délai initial pour la création du schéma au premier démarrage et le
  réchauffement de l'index ; la sonde de vivacité revérifie toutes les 30
  secondes avec un seuil de 3 échecs.
- **Pas de mise à l'échelle horizontale, pas de coordination de file d'attente.**
  Parce que l'état entier de l'application — base de données SQLite, index,
  cache de vignettes et originaux — réside sur un seul volume gcsfuse
  inscriptible, PhotoPrism doit s'exécuter en instance unique (`min_instance_count = max_instance_count = 1`) ;
  il n'y a pas de support multi-rédacteur.
- **Inspecter la configuration et le stockage en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep PHOTOPRISM_
  gcloud run jobs list --project "$PROJECT" --region "$REGION"   # empty unless custom jobs were added
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
PhotoPrism sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
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
| `application_name` | `photoprism` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `PhotoPrism` | Nom lisible par l'homme affiché dans la console. |
| `description` | `PhotoPrism — AI-powered photo management app` | Description du service. |
| `application_version` | `latest` | Tag d'image `photoprism/photoprism` utilisé comme base de build personnalisé ; `latest` est épinglé à un tag connu et valide (`240915`) au moment du build. |
| `admin_username` | `admin` | Nom d'utilisateur du compte administrateur initial (`PHOTOPRISM_ADMIN_USER`) ; le mot de passe est généré séparément. |
| `site_url` | `""` | URL publique du site (`PHOTOPRISM_SITE_URL`). Vide, revient à l'hôte de la requête ; à définir une fois que l'URL Cloud Run est connue pour des liens absolus corrects. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | "PhotoPrism charge les index vectoriels en mémoire ; dimensionnez-le en fonction de vos collections." 2 Gi est le minimum qui maintient la reconnaissance faciale/le support RAW activés — la valeur par défaut de `PhotoPrism_Common` est `4Gi` pour les charges de travail d'indexation réelles sur de grandes bibliothèques. |
| `min_instance_count` | `1` | Fixé à 1 pour éviter les démarrages à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | **Maintenir à 1** — une seule instance PhotoPrism pour la cohérence des données. |
| `container_port` | `2342` | Port du serveur HTTP de PhotoPrism. |
| `execution_environment` | `gen2` | **Obligatoire** — les volumes GCS FUSE ne fonctionnent qu'avec la génération 2. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Également codé en dur `false` dans `main.tf` quelle que soit cette variable — PhotoPrism n'a pas de Cloud SQL. |
| `container_protocol` | `http1` | HTTP/1.1 est suffisant ; PhotoPrism ne nécessite pas `h2c`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image basée sur `photoprism/photoprism` construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité des conventions ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet un accès direct à l'interface utilisateur web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'interface utilisateur. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple, réglage `PHOTOPRISM_*` supplémentaire). Ne pas définir `PHOTOPRISM_ADMIN_PASSWORD` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/conformité. |
| `enable_backup_import` | `false` | Restaurer à partir d'une sauvegarde lors du déploiement. |
| `backup_source` | `gcs` | `gcs` ou `gdrive`. |
| `backup_uri` | `""` | Emplacement de la sauvegarde ; utilisé uniquement lorsque `enable_backup_import = true`. |
| `backup_format` | `tar` | Puisque PhotoPrism n'a pas de base de données SQL, une restauration de sauvegarde est une archive de système de fichiers du bucket média/bibliothèque, pas un dump de base de données — gardez ce format orienté archive de fichiers (`tar`/`zip`/etc.), pas `sql`. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Non applicable — PhotoPrism n'a pas de base de données SQL. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | _(vide)_ | Non applicable à PhotoPrism. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Découverte facultative de VM NFS préexistantes/intégrées. Transmis mais inutilisé par défaut — PhotoPrism s'appuie sur le volume GCS FUSE, pas NFS, pour la persistance (`enable_nfs = false`). |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS — attention aux réponses photo/média mises en cache si activé. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` auto-provisionné plus ceux de `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données PhotoPrism auto-provisionné. |
| `enable_nfs` | `false` | Désactivé par défaut et non nécessaire — le volume GCS FUSE est le stockage principal de PhotoPrism sur cette variante. |
| `nfs_mount_path` | `/mnt/nfs` | Inerte sauf si `enable_nfs = true`. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le volume PhotoPrism `storage` à `/photoprism` est ajouté automatiquement par `PhotoPrism_Common`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (valeur par défaut de la variable) → **forcé `false`** | `main.tf` code en dur `enable_redis = false` quelle que soit cette valeur — PhotoPrism n'a pas d'intégration Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Inerte — jamais injecté puisque Redis est désactivé de force. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Aucune base de données SQL n'est utilisée par PhotoPrism. Contrairement à la variante GKE, **cette valeur est toujours transmise à la fondation** — voir le piège au §6 avant de la modifier. |
| `database_password_length` | `32` | Inerte — aucun mot de passe de base de données n'est jamais généré tant que `database_type = NONE`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation intégré — PhotoPrism amorce son propre schéma SQLite. Ajoutez des jobs personnalisés uniquement pour des tâches de chargement/maintenance de données spécifiques. |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme par défaut (par exemple, on pourrait en ajouter une pour des instantanés de bibliothèque périodiques). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/status`, délai de 15s, période de 10s, seuil de 10 échecs | Sonde de démarrage principale (fenêtre d'environ 1m55s après le délai). |
| `liveness_probe` | HTTP `/api/v1/status`, délai de 30s, période de 30s, seuil de 3 échecs | Sonde de vivacité principale. |
| `startup_probe_config` | `enabled = true`, chemin `/api/v1/status` | Surface de sonde de démarrage structurée alternative. {/* TODO: vérifier la précédence par rapport à `startup_probe` si les deux sont définis à des valeurs conflictuelles — contrairement à certains modules frères, cette surface alternative par défaut `enabled = true` ici, non désactivée. */} |
| `health_check_config` | `enabled = true`, chemin `/api/v1/status` | Surface de sonde de vivacité structurée alternative (même mise en garde de précédence que ci-dessus). |
| `uptime_check_config` | `{ enabled = false, path = "/api/v1/status" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `organization_id` | `""` | Remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `photoprism_url` | L'URL du service Cloud Run. La description de la sortie elle-même l'appelle une "URL VPC interne… uniquement accessible au sein du même VPC lorsque ingress_settings est 'internal'" — mais `ingress_settings` par défaut à `all` (public) ; vérifiez l'accessibilité réelle du service déployé par rapport à votre propre valeur `ingress_settings` plutôt que de supposer à partir du nom de la sortie. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés, y compris le bucket GCS FUSE PhotoPrism `storage`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés (vide par défaut). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

Notez qu'il n'y a pas de sorties `database_*` — aucune instance Cloud SQL n'est
provisionnée par défaut (contrairement aux modules de type Activepieces/BookStack).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identités autorisées, un environnement d'exécution `gen1` avec des
> montages GCS Fuse, une valeur `container_port`/`backup_retention_days` hors plage. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` / `min_instance_count` | `1` / `1` | Critique | La mise à l'échelle au-delà de 1 donne à deux instances une seule base de données SQLite inscriptible montée par gcsfuse — risque de corruption/conflit de verrouillage, pire qu'un PVC de bloc car le modèle de cohérence de gcsfuse est plus faible. |
| `execution_environment` | `gen2` | Critique | `gen1` ne peut pas monter les volumes GCS FUSE — l'intégralité du répertoire de données `/photoprism` (DB, médias) ne parvient pas à se connecter et l'application ne peut pas démarrer. |
| `database_type` | `NONE` | Moyen | Contrairement à `PhotoPrism_GKE` (qui code en dur `NONE`), ce module transmet toujours la variable à la fondation. La définir à `MYSQL`/`POSTGRES` provisionne une instance Cloud SQL réelle et facturée que `PhotoPrism_Common` ne connecte jamais à l'application (aucun `DB_HOST`/`DB_USER` n'est consommé) — coût gaspillé sans avantage fonctionnel. |
| `enable_redis` | Forcé `false` dans `main.tf` | Faible | Aucune action nécessaire — la surcharge est intentionnelle et ne peut être annulée en définissant la variable `true`. |
| `enable_cloudsql_volume` | `false` (par défaut et codé en dur) | Faible | Ne peut pas être activé même en définissant la variable — à titre informatif uniquement. |
| `memory_limit` | `2Gi` par défaut — à augmenter pour les bibliothèques réelles | Élevé | La base de référence de `PhotoPrism_Common` est `4Gi` pour les charges de travail d'indexation/reconnaissance faciale ; 2 Gi est le minimum qui maintient ces fonctionnalités activées mais peut toujours risquer des OOM kills une fois qu'une bibliothèque a un volume photo/vidéo significatif. |
| `PHOTOPRISM_ADMIN_PASSWORD` (généré automatiquement) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous bloque l'accès au premier compte administrateur jusqu'à la réinitialisation via la base de données. |
| `site_url` | Définir sur l'URL Cloud Run déployée une fois connue | Moyen | Laissé vide, PhotoPrism revient à l'hôte de la requête ; les liens absolus/URL de vignettes peuvent être incorrects derrière un équilibreur de charge ou un domaine personnalisé. |
| `ingress_settings` | `all` pour un accès direct à l'interface utilisateur web | Moyen | La définition à `internal` bloque l'accès du navigateur à l'interface utilisateur, sauf si elle est atteinte via un client connecté au VPC ou un équilibreur de charge interne. |
| `backup_format` | Un format d'archive de fichiers (`tar`, `zip`, …), pas `sql` | Moyen | PhotoPrism n'a pas de base de données SQL — un `backup_uri` pointant vers un dump de base de données est insignifiant pour cette application ; les sauvegardes doivent cibler le contenu du bucket média/bibliothèque. |
| `enable_nfs` | `false` | Faible | Valeur par défaut correcte — PhotoPrism n'a pas besoin de NFS puisque le volume GCS FUSE est son stockage principal ; l'activer ajoute des coûts sans avantage, sauf si des jobs personnalisés nécessitent un accès partagé au système de fichiers. |
| `backup_retention_days` | `7` (à augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur web publique et la connexion administrateur sont accessibles sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à PhotoPrism partagée avec la variante GKE — les
identifiants administrateur, le moteur de base de données SQLite intégré, la
disposition du stockage, le build du conteneur et les sondes de santé par
défaut — est décrite dans **[PhotoPrism_Common](PhotoPrism_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : PhotoPrism sur Cloud Run](../labs/PhotoPrism_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PhotoPrism sur GKE Autopilot](PhotoPrism_GKE.md) — la même application sur Kubernetes, pour les cas où vous avez besoin de l'autre cible de déploiement.
- [PhotoPrism Common — Configuration d'application partagée](PhotoPrism_Common.md) — la configuration partagée par les deux cibles de déploiement.
