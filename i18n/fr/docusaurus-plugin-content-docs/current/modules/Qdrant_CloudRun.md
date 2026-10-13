---
title: "Qdrant sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Qdrant sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Qdrant_CloudRun.md @ e69407af sha256:3325a457f323 -->

# Qdrant sur Google Cloud Run {#qdrant-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Qdrant_CloudRun.png" alt="Qdrant sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Qdrant est une base de données vectorielle et un moteur de recherche de
similarité haute performance conçus pour les charges de travail d'IA — pipelines
RAG, systèmes de recommandation, recherche sémantique et stockage d'embeddings.
Ce module déploie Qdrant sur **Cloud Run v2** en s'appuyant sur la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Qdrant et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, scaling et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes
et cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Qdrant sur RAD, et comparaison {#what-qdrant-costs-on-rad-and-how-that-compares}

**L'exécution de Qdrant dans votre propre projet Google Cloud coûte environ 19,14 $ US/mois en infrastructure, plus des frais de module uniques de 40 crédits RAD** (dimensionnés à 1 vCPU / 1 GiB sur une instance Cloud Run chaude toujours active). RAD facture les frais de module une seule fois, au moment du déploiement — jamais plus lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la marge de RAD — environ 9 crédits/jour — et les frais de module sont 10 % inférieurs, à 36 crédits. Voir "Mettez-le en pause gratuitement" ci-dessous pour savoir comment un déploiement Qdrant géré par RAD peut être arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin. (ou consultez le [guide GKE](Qdrant_GKE.md) si vous avez besoin de Kubernetes)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Élément | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits (une fois) | 36 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~19,14 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~9 crédits/jour, mesurés à l'heure au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (add-ons, sauvegardes) | 1 |
| **Total** | **19,14 $** |

### Comparaison {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement comparable, pour ce projet open-source exact, donc la comparaison honnête est un simple serveur autogéré : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un Droplet DigitalOcean 2 vCPU/4 Go (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte de cette application (1 vCPU ou moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes, donc un serveur autogéré dimensionné pour correspondre coûterait moins cher que les chiffres ci-dessus — mais vous seriez toujours responsable de chaque patch, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour un montant similaire ou identique est une base de données gérée, des identifiants conservés dans Secret Manager, la surveillance et une mise à jour en un clic, ce qu'un VPS nu ne vous offre pas gratuitement.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du système d'exploitation/de la base de données, effectuez et testez les sauvegardes, et renouvelez les certificats ; Cloud SQL géré par RAD, Secret Manager et la surveillance gèrent les trois pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option phare sur un projet **géré par RAD**, et elle est gratuite pendant la pause. La suppression
d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet lui-même —
la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne
détruit pas la base de données, aucune VM, ou la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet — demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les
mêmes ressources déjà présentes : c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. L'ensemble de la restauration ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build
pour une chaîne de déploiements typique. Ce qu'il faut : vous devez être propriétaire du projet (pas seulement
faire gérer sa facturation par RAD), vous devez le restaurer vous-même dans les 30 jours — après quoi Google
le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de
crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de
démonstration conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, de sorte que le bucket de sauvegarde est très probablement
supprimé dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google
Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **propre projet** (ou un projet géré par RAD au-delà de sa fenêtre de restauration de 30 jours),
est de supprimer Qdrant purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module
plus les builds — environ **43-46 crédits** au total pour ce module.

La suppression ne permet d'économiser de l'argent que si Qdrant resterait inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour ce module, cela représente environ 7 jours ou plus d'inactivité,
basé sur son propre coût d'exécution de 19,14 $ US/mois ci-dessus. La majeure partie de ce coût d'exécution est
généralement la base de données et toute VM de fichier/cache partagée, et ils ne s'arrêtent que lorsque rien d'autre dans le
projet ne les utilise, donc la suppression de cette application seule n'économise que sa propre part de calcul si quelque chose d'autre
partage le projet.

**Conservez les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec
celui-ci, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
  le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Resource Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Qdrant s'exécute en tant que service Cloud Run v2 (Gen2) avec un bucket Cloud
Storage monté via GCS FUSE pour le stockage persistant des collections. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Qdrant, 1 vCPU / 1 GiB par défaut, `min_instance_count = 1` |
| Stockage persistant | Cloud Storage via GCS FUSE | Bucket `<prefix>-storage` monté à `/qdrant/storage` via Gen2 GCS FUSE CSI |
| Secrets | Secret Manager | Clé API optionnelle (`QDRANT__SERVICE__API_KEY`) |
| Ingress | URL Cloud Run / Cloud Load Balancing | Par défaut `internal` (VPC uniquement) ; équilibreur de charge HTTPS optionnel avec Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL, pas de Redis.** Qdrant gère son propre stockage
  embarqué. Aucune instance Cloud SQL ou dépendance Redis n'est créée.
- **Instance unique par défaut.** `max_instance_count = 1` est fortement
  recommandé. Qdrant est un magasin à écrivain unique — plusieurs instances
  écrivant sur le même montage GCS FUSE corrompent les collections.
- **Ingress interne par défaut.** `ingress_settings = "internal"` restreint
  l'accès au VPC. Le passage à `"all"` (internet public) nécessite
  `enable_api_key = true` — une validation au moment de la planification bloque la
  combinaison d'un ingress public sans clé API.
- **L'environnement d'exécution Gen2 est requis** pour les montages GCS FUSE. Le
  module utilise par défaut `execution_environment = "gen2"`.
- **Deux points de terminaison de santé distincts.** Le démarrage utilise
  `/readyz` ; la vivacité utilise `/livez`. Ne jamais pointer la sonde de
  vivacité vers `/readyz` — Qdrant se marque temporairement comme non prêt
  lors du chargement de grandes collections, ce qui provoque des redémarrages
  intempestifs des conteneurs.
- **gRPC nécessite le protocole `h2c`.** Cloud Run n'expose pas le port
  6334. Utilisez `container_protocol = "h2c"` et un client gRPC sur le port principal si
  gRPC est nécessaire.
- **Redis est déclaré mais inerte.** `enable_redis` est par défaut `true` au
  niveau de la variable (la valeur par défaut de la fondation `App_CloudRun`), mais
  le `Qdrant_CloudRun` de `main.tf` code en dur `enable_redis = false` sur l'appel à
  `App_CloudRun` quelle que soit la valeur de la variable — `redis_host`,
  `redis_port` et `redis_auth` n'ont aucun effet. Qdrant n'a aucune
  dépendance de mise en cache.
- **Le build du conteneur est fixé par `Qdrant_Common`.** `container_image`,
  `container_image_source`, `container_build_config` et `container_resources`
  sont déclarés uniquement pour la convention de la fondation — `Qdrant_Common`
  définit l'image réelle (`qdrant/qdrant`), la source du build (`custom`,
  via un Dockerfile léger) et la forme des ressources en interne et ignore ces
  quatre variables.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms des services et des ressources sont indiqués dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Qdrant {#a-cloud-run--the-qdrant-service}

Qdrant s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable. Le service s'adapte entre le nombre minimum et maximum
d'instances en fonction de la concurrence des requêtes.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence,
l'environnement d'exécution et le partage de trafic.

### B. Cloud Storage — stockage persistant de Qdrant {#b-cloud-storage--qdrant-persistent-storage}

Qdrant persiste son WAL, ses données de collection, ses fichiers d'index HNSW et
ses métadonnées à `/qdrant/storage` à l'intérieur du conteneur. Ce chemin est
soutenu par un bucket Cloud Storage (`<prefix>-storage`) monté via GCS FUSE. Le
bucket est provisionné automatiquement par le module.

- **Console :** Cloud Storage → Buckets — trouvez le bucket `*-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/
  gcloud storage ls gs://<storage-bucket>/collections/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails de GCS Fuse et les
options CMEK.

### C. Secret Manager — clé API Qdrant {#c-secret-manager--qdrant-api-key}

Lorsque `enable_api_key = true`, une clé API alphanumérique de 32 caractères est générée
et stockée dans Secret Manager. Elle est injectée en tant que `QDRANT__SERVICE__API_KEY` au
moment de l'exécution, exigeant que tous les appelants REST et gRPC passent
`api-key: <key>` dans les en-têtes de requête.

- **Console :** Sécurité → Secret Manager — recherchez un secret nommé
  `<resource-prefix>-api-key`.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<api-key-secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le service n'est accessible que depuis l'intérieur du VPC
(`ingress_settings =
"internal"`). Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés lorsque le service
doit être accessible depuis l'extérieur du VPC.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring. Des tests de disponibilité optionnels (contre
`/readyz`) et des politiques d'alerte sont disponibles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" \
    --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Qdrant {#3-qdrant-application-behaviour}

- **Pas de bootstrap de base de données.** Qdrant gère son propre moteur de
  stockage embarqué. Aucun job d'initialisation n'est injecté par défaut. Le
  service démarre immédiatement après que le conteneur est prêt.
- **Chargement des collections au démarrage.** Qdrant charge toutes les
  collections de GCS FUSE en mémoire pendant le démarrage. Pour les instances
  avec de grandes collections, le démarrage peut prendre des dizaines de
  secondes. La sonde de démarrage (`/readyz`) attend que cela soit terminé
  avant que le trafic ne soit envoyé à l'instance.
- **Points de terminaison de vivacité et de disponibilité séparés.**
  `/readyz` renvoie 503 pendant le chargement des collections ;
  `/livez` renvoie toujours 200 tant que le processus est actif. La sonde
  de vivacité utilise `/livez` pour éviter les redémarrages intempestifs
  des conteneurs pendant le chargement des collections. Ne changez pas la sonde
  de vivacité en `/readyz`.
- **Contrainte d'écrivain unique.** Plusieurs instances Cloud Run ne peuvent pas
  partager en toute sécurité le même chemin de stockage GCS FUSE. Gardez
  `max_instance_count = 1`. Évoluez verticalement (augmentez le CPU et la mémoire) pour
  un débit plus élevé.
- **gRPC sur HTTP/2.** Cloud Run n'expose pas de deuxième port pour gRPC.
  Utilisez `container_protocol = "h2c"` avec un client gRPC qui se connecte
  sur HTTP/2 sur le port 6333 si gRPC est nécessaire.
- **Tâches planifiées.** Utilisez `cron_jobs` pour planifier des instantanés
  périodiques de collections Qdrant via l'API REST ou pour des routines de
  maintenance personnalisées, exécutées en tant que Jobs Cloud Run.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Qdrant sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `qdrant` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Qdrant Vector Database` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service Cloud Run affichée dans l'interface utilisateur de la plateforme. |
| `application_description` | _(défini)_ | Champ de description alternatif reflétant la fondation ; remplit la même description de service Cloud Run. |
| `application_version` | `latest` | Tag de version de l'image Qdrant ; épingler à un tag semver pour la production (par exemple `v1.9.0`). |
| `enable_api_key` | `false` | Générer une clé API aléatoire dans Secret Manager ; requis avant de définir `ingress_settings = "all"`. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Augmenter à `2000m`–`4000m` pour les builds d'index de production et les requêtes concurrentes. |
| `memory_limit` | `1Gi` | Mémoire par instance. Qdrant charge les index HNSW en RAM — taille basée sur les dimensions de la collection et le nombre de vecteurs. |
| `min_instance_count` | `1` | Instances minimales. Garder ≥ 1 pour éviter les démarrages à froid pendant le chargement de l'index HNSW. |
| `max_instance_count` | `1` | Instances maximales. Garder à 1 — Qdrant est un magasin à écrivain unique. |
| `container_port` | `6333` | Port de l'API REST Qdrant. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS FUSE. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 s). Augmenter pour les insertions en masse importantes ou les opérations d'instantané. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Qdrant dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `container_protocol` | `http1` | Utiliser `h2c` pour activer HTTP/2 pour les clients gRPC se connectant sur le port 6333. |
| `traffic_split` | `[]` | Allocation de trafic entre les révisions pour les déploiements canary ou bleu-vert. |
| `max_revisions_to_retain` | `7` | Nombre maximal de révisions Cloud Run à conserver. Non référencé — aucun effet sur le déploiement dans ce module d'application. |
| `enable_cloudsql_volume` | `false` | Injecte un sidecar Cloud SQL Auth Proxy. Non applicable — Qdrant n'a pas de base de données SQL ; laisser `false`. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Non applicable — Qdrant n'a pas de base de données Cloud SQL. |
| `service_annotations` / `service_labels` | `{}` | Annotations / libellés de service Cloud Run personnalisés. |
| `container_image_source` / `container_image` / `container_build_config` / `container_resources` | `custom` / `""` / _(défini)_ / _(défini)_ | Déclaré uniquement pour la convention de la fondation. `Qdrant_Common` fixe l'image réelle, la source du build et la forme des ressources ; ces quatre n'ont aucun effet. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` (VPC uniquement, recommandé), `all` (nécessite `enable_api_key = true`), ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Utilisez les clés `QDRANT__…` pour remplacer la configuration de Qdrant. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation de Secret Manager (30 jours par défaut). |
| `prereq_subnet_cidr_override` | `""` | Remplacement du CIDR du sous-réseau primaire VPC en ligne. Définir uniquement lors de la réapplication d'un déploiement existant pour éviter le remplacement des ressources. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |
| `backup_file` | `backup.sql` | Nom de fichier de la sauvegarde à importer ; utilisé uniquement lorsque `enable_backup_import = true`. Listé dans la plateforme sous Groupe 13 (Jobs). |
| `additional_services` | `[]` | Services Cloud Run supplémentaires déployés avec Qdrant (par exemple, un worker sidecar ou un proxy). Non utilisé par défaut. |
| `additional_containers` | `[]` | Conteneurs sidecar in-pod partageant le même service Cloud Run et localhost. Non utilisé par défaut — Qdrant n'a pas de processus compagnon. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`, `binauthz_evaluation_mode` (non référencé —
le définir n'a aucun effet sur ce module d'application).

### Groupe 9 — NFS et SQL personnalisé {#group-9--nfs--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Qdrant utilise GCS pour le stockage — activer NFS uniquement pour les jobs d'initialisation personnalisés qui nécessitent un système de fichiers partagé. Nécessite Gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante à utiliser. Laisser vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour une VM GCE NFS en ligne. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Cloud Run pour le montage NFS. Remplacer pour un deuxième partage NFS. |
| `enable_custom_sql_scripts` | `false` | Non applicable — Qdrant n'a pas de base de données SQL. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | `""` / `""` / `false` | Non applicable — accepté uniquement pour la compatibilité avec la fondation. |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS (SSL géré par Google). |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées d'Artifact Registry. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. Définir à `0` pour désactiver. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de stockage GCS. |
| `storage_buckets` / `gcs_volumes` | `[]` | Buckets supplémentaires / montages GCS FUSE. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (valeur par défaut de la variable) | **Inerte.** `main.tf` code en dur `enable_redis = false` sur l'appel `App_CloudRun` quelle que soit cette valeur — Qdrant n'a pas de dépendance de mise en cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | **Inerte** — jamais transféré, car Redis est désactivé en dur. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable — Qdrant n'a pas de base de données SQL. `database_type` est transmis à
`App_CloudRun` mais sa valeur par défaut (`NONE`) est la seule valeur
prise en charge ; la modifier ne donnerait pas à Qdrant une connexion de base de
données fonctionnelle car `Qdrant_Common` ne connecte jamais les identifiants de
base de données au conteneur. Les éléments suivants sont acceptés uniquement
pour la compatibilité avec la fondation et n'ont aucun effet : `sql_instance_name`,
`sql_instance_base_name`, `database_password_length`, `application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`,
`mysql_plugins`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Qdrant ne nécessite pas de job d'initialisation par défaut ; fournir uniquement des tâches de chargement de données ou de migration personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents pour les instantanés de collection périodiques ou la maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/readyz`, délai de 15s | Sonde HTTP — Qdrant signale qu'il est prêt une fois toutes les collections chargées. |
| `liveness_probe` | `/livez`, délai de 30s | Sonde HTTP — point de terminaison de vivacité dédié non affecté par l'état de chargement de la collection. |
| `startup_probe_config` | `enabled=true, path=/readyz` | Interface de sonde de démarrage alternative au niveau de la fondation. |
| `health_check_config` | `enabled=true, path=/livez` | Interface de sonde de vivacité alternative au niveau de la fondation. |
| `uptime_check_config` | désactivé, `/readyz` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 15 — Réseau avancé {#group-15--advanced-networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` | Nom du réseau VPC à utiliser. Laisser vide pour découvrir automatiquement un seul réseau géré par Services_GCP ; requis uniquement lorsqu'il en existe plus d'un dans le projet. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode d'exécution à sec. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 0 — Métadonnées du module (avancé/interne) {#group-0--module-metadata-advancedinternal}

Au-delà des métadonnées orientées plateforme (`module_description`, `module_documentation`,
`module_dependency`, `module_services`, `credit_cost`, `require_credit_purchases`,
`enable_purge`, `public_access`, `shared_users`, `technical_support_users`,
`resource_creator_identity`, `impersonation_service_account`,
`require_services_gcp_module`), trois variables contrôlent le provisionnement interne de la
plateforme et ne sont normalement pas définies manuellement : `requires_services` (indique à la
plateforme quelles ressources `Services_GCP` provisionner automatiquement pour ce module —
par défaut, le chemin de la VM Compute NFS/Redis gratuite, non géré par Memorystore/Filestore),
`job_execution_wait_timeout` (`900` — combien de temps le déploiement attend un
job d'initialisation avant d'avorter), et `module_writable_secret_ids` (`{}` —
octrois d'écriture Secret Manager pour les hooks post-installation ; inutilisé par Qdrant).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `qdrant_url` | URL VPC interne pour l'API REST Qdrant (port 6333). Accessible uniquement depuis le même VPC lorsque `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_api_key` | `true` (tout déploiement externe) | Critique | Sans clé API, tout appelant pouvant atteindre le service peut lire, modifier ou supprimer toutes les collections. |
| `ingress_settings` | `internal` (par défaut) | Critique | Définir à `"all"` sans `enable_api_key = true` est bloqué au moment de la planification ; cela expose Qdrant à l'internet public. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; la modification recrée le stockage et perd toutes les collections. |
| `max_instance_count` | `1` | Élevé | Plusieurs instances écrivant sur le même chemin GCS FUSE corrompent les collections — Qdrant est un magasin à écrivain unique. |
| `liveness_probe` chemin | `/livez` (par défaut) | Élevé | Pointer la vivacité vers `/readyz` provoque des redémarrages intempestifs des conteneurs chaque fois qu'une grande collection est chargée depuis GCS. |
| `memory_limit` | ≥ `4Gi` pour la production | Élevé | La valeur par défaut `1Gi` ne prend en charge que les petites collections de test ; les OOM kills terminent toutes les requêtes en cours et déclenchent un rechargement complet de l'index depuis GCS. |
| `execution_environment` | `gen2` (par défaut) | Élevé | GCS FUSE nécessite Gen2 ; les déploiements Gen1 avec `enable_nfs = true` échouent au moment de la planification. |
| `application_version` | épingler à semver pour la production | Moyen | L'utilisation de `latest` peut entraîner une mise à niveau involontaire du format de stockage qui rend les collections existantes illisibles. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro provoque un rechargement à froid de toutes les collections depuis GCS lors de la prochaine requête ; à éviter pour les charges de travail sensibles à la latence. |
| `timeout_seconds` | `300` | Moyen | Les grandes recherches ANN, les insertions en masse ou les opérations d'instantané peuvent dépasser la valeur par défaut — augmenter à `600` ou plus pour les charges de travail lourdes. |
| `enable_iap` / `enable_cloud_armor` | activer pour les déploiements exposés | Élevé | Sans contrôles d'accès, l'API REST Qdrant est accessible par tout appelant sur le réseau autorisé. |
| `secret_propagation_delay` | `30` | Moyen | Dans les grands projets, la réplication de Secret Manager peut dépasser 30 s ; augmenter à `60` pour éviter de lire un secret de clé API vide. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | laisser les valeurs par défaut | Faible | Inerte — `main.tf` désactive Redis en dur quelle que soit la valeur de ces variables. Les définir n'a aucun effet et n'indique pas une mauvaise configuration. |
| `database_type` / `sql_instance_name` et les autres variables de base de données du Groupe 12 | laisser les valeurs par défaut | Faible | Inerte pour Qdrant — `Qdrant_Common` ne connecte jamais les identifiants de base de données au conteneur, donc modifier ces variables ne crée pas de connexion de base de données utilisable. |
| `container_image` / `container_image_source` / `container_build_config` / `container_resources` | laisser les valeurs par défaut | Faible | Inerte — `Qdrant_Common` fixe l'image réelle, la source du build et la forme des ressources. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, scaling et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Qdrant partagée avec la variante GKE est décrite
dans **[Qdrant_Common](Qdrant_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Qdrant sur Cloud Run](../labs/Qdrant_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Qdrant sur GKE Autopilot](Qdrant_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Qdrant Common — Configuration d'application partagée](Qdrant_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), [MongoDB sur GKE Autopilot](MongoDB_GKE.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) dans la solution **Shared Data Services**.
