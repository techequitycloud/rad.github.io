---
title: "Komga sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Komga sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Komga_CloudRun.md @ e69407af sha256:02a3f13590f5 -->

# Komga sur Google Cloud Run {#komga-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Komga_CloudRun.png" alt="Komga sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Komga est un serveur multimédia gratuit, open source et auto-hébergé pour les
bandes dessinées, les mangas et les collections de livres numériques (Kotlin/Java,
Spring Boot). Il offre une interface utilisateur de lecture web claire, des flux
OPDS, des collections, des listes de lecture et une recherche en texte intégral
dans votre bibliothèque. Ce module déploie Komga sur **Cloud Run v2** au-dessus
de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Komga et sur la façon
de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Komga sur RAD, et comment cela se compare {#what-komga-costs-on-rad-and-how-that-compares}

**Komga sur le module Cloud Run de RAD coûte environ 33 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 40 crédits (4,00 $ US).** Komga est gratuit et open source, sans base de données à exécuter — son catalogue réside dans un fichier SQLite embarqué sur le serveur de fichiers partagé. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 33 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4,00 $ US au prix de la recharge) | 36,0 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **33 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **15 crédits par jour**, environ 450 par mois (environ 45 $ US au prix de la recharge, 36 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| **Total** | **environ 33 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun fournisseur ne vend de Komga SaaS hébergé** — c'est un serveur multimédia auto-hébergé par conception, il n'y a donc pas de prix officiel à comparer.
- **Komga est léger** (1 vCPU/1 GiB, pas de base de données), donc une machine auto-gérée plus petite/moins chère que la classe de comparaison habituelle suffit souvent — une petite instance Hetzner ou DigitalOcean bien en dessous de la classe 2 vCPU/4 Go, 24 $/mois peut l'exécuter, plus votre propre temps pour le système d'exploitation, les sauvegardes et les correctifs de sécurité.
- Le chiffre de RAD est plus élevé principalement en raison de la passerelle NAT et du serveur de fichiers toujours actifs plutôt que de Komga lui-même, c'est pourquoi l'écart se réduit si ce projet exécute déjà une autre application partageant ceux-ci.
- Voir le [guide GKE](Komga_GKE.md) si vous préférez l'exécuter avec d'autres charges de travail Kubernetes.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Komga s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à Komga dont vous n'avez besoin qu'occasionnellement —
un projet de cours, une démo, une évaluation de courte durée — que de
l'exécuter en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime
  pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours.
  Comme la facturation est déjà déliée, rien n'est facturé pendant cette
  attente. Contrairement à la suppression d'un seul module, cela ne détruit pas
  une VM ou le propre calcul de Komga un par un — l'ensemble du projet, et tout
  ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans
  les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture jamais à nouveau les frais
  de module. Pour Komga derrière un petit Services_GCP et Project_GCP, cela
  représente **une poignée de crédits (moins de 1 $ US)** au total, contre les
  45 crédits que coûte un redéploiement complet.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations d'étude et de
  démo conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes nocturnes de Komga sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression
  logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès
  que vous supprimez le projet — même si le projet lui-même est récupérable
  pendant 30 jours. Si vous avez personnalisé Komga et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket
  extérieur au projet) avant de supprimer, comme pour le flux de travail de
  redéploiement ci-dessous. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Ce module maintient Cloud Run chaud (au moins une instance allouée) plutôt que de se mettre à l'échelle à zéro, de sorte qu'une partie de son coût est déjà continue. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45 crédits (4,50 $ US), car RAD recrée le projet et les services partagés avant Komga. La suppression permet d'économiser de l'argent seulement si Komga resterait inutilisé pendant environ cinq jours ou plus, à la fois dans votre propre projet (environ 1,09 $ US par jour) et dans un projet géré par RAD (15 crédits par jour).
- **Supprimez tout ce que Komga utilise.** La majeure partie du coût d'exécution est généralement la VM de fichier/cache partagée. Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de Komga alors que quelque chose d'autre partage le projet n'économise que la partie de calcul propre à Komga.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session Komga
  pour une classe. Chaque participant dispose de Komga dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places à
  l'avance, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  Komga pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la
  facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin de l'engagement, le
  partenaire remet le projet, et les déploiements deviennent la propriété du
  client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation quotidienne de 15 crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Komga s'exécute comme un conteneur JVM unique sur Cloud Run v2. Le déploiement
relie un ensemble minimal de services Google Cloud — il n'y a pas de base de
données externe :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur JVM (Spring Boot), 1 vCPU / 1 GiB par défaut ; instance unique |
| Base de données | Aucune | Komga utilise une base de données SQLite embarquée sous `/config` — aucune instance Cloud SQL n'est créée |
| Stockage partagé | Filestore (NFS) | Monté à `/config` (`enable_nfs = true`) ; contient les bases de données SQLite et l'index |
| Stockage d'objets | Cloud Storage | Un bucket `storage`, monté à `/config` via GCS FUSE uniquement si NFS n'est pas |
| Secrets | Secret Manager | Aucun généré — Komga n'a pas de secret de service injectable |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** Komga stocke son index de bibliothèque, ses
  utilisateurs, sa progression de lecture et ses paramètres dans une base de
  données SQLite embarquée — confirmé via le problème amont #1327 (demande de
  fonctionnalité ouverte et non implémentée pour le support de base de données
  externe). `database_type = "NONE"`.
- **Image officielle pré-construite.** `container_image_source = "prebuilt"` déploie
  `gotson/komga` directement — pas d'étape Cloud Build. `enable_image_mirroring = true`
  la met en miroir dans Artifact Registry (copie consciente du digest) pour
  éviter les limites de débit de Docker Hub.
- **Instance unique uniquement.** `min_instance_count = 1` et `max_instance_count = 1` —
  Komga sert une bibliothèque SQLite partagée à partir d'un seul volume ; ne pas
  mettre à l'échelle au-delà de 1.
- **`/config` est la source unique de vérité.** La base de données SQLite
  (`database.sqlite`, mode WAL), l'index de recherche Lucene, le cache de
  miniatures et la file d'attente des tâches vivent tous sous `/config`
  (défini via le `KOMGA_CONFIGDIR` de l'image), sauvegardés par le partage NFS
  sur Cloud Run.
- **Pas de secrets générés.** Le compte administrateur est créé
  interactivement via l'assistant de configuration de première exécution de
  Komga à `/` — il n'y a pas de clé maîtresse ou de secret JWT à
  amorcer à l'avance.
- **Le point de terminaison de santé est `/actuator/health`.** Confirmé via des tests de
  conteneur locaux pour renvoyer `200 {"status":"UP"}` non authentifié. Le chemin
  versionné `/api/v1/actuator/health` est protégé par authentification (401) — ne pas y
  pointer les sondes.
- **Le dimensionnement du tas JVM est facultatif.** `jvm_heap_max` (vide par
  défaut) définit `-Xmx` via `JAVA_TOOL_OPTIONS` ; laisser vide pour
  laisser l'ergonomie JVM dimensionner le tas par rapport à `memory_limit`.
- **`/config` ne doit pas être sur GCS FUSE.** gcsfuse manque le verrouillage de
  fichiers et le fichier de mémoire partagée dont le mode WAL de SQLite a
  besoin, et les deux bases de données y sont perdues. La valeur par défaut
  maintient `/config` sur NFS ; les propres vérifications de démarrage de
  Komga refusent une base de données sur tout système de fichiers réseau (elles
  testent le type de système de fichiers, pas si le verrouillage fonctionne) ;
  le module définit `KOMGA_DATABASE_CHECKLOCALFILESYSTEM` et `KOMGA_TASKSDB_CHECKLOCALFILESYSTEM` à
  `false` uniquement lorsque `/config` est sur NFS.
  `Komga_GKE` utilise un PVC de bloc à la place.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Komga {#a-cloud-run--the-komga-service}

Komga s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

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

### B. Cloud Storage — l'état persistant de Komga {#b-cloud-storage--komgas-persistent-state}

Par défaut, `/config` est le partage **Filestore (NFS)** (`enable_nfs = true`,
`nfs_mount_path = "/config"`). Il contient les bases de données SQLite embarquées, l'index
de recherche Lucene, le cache de miniatures et les journaux — tout ce que Komga
persiste. Un bucket `storage` est également créé ; il est monté à
`/config` via GCS FUSE uniquement si NFS est désactivé ou monté
ailleurs, et cette configuration ne conserve pas les bases de données SQLite.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS Fuse et les options CMEK.

### C. Secret Manager {#c-secret-manager}

Komga n'a pas de secret de service généré — le compte administrateur est créé
via l'assistant de configuration web. Secret Manager ne contient que les
entrées que vous ajoutez vous-même via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Komga {#3-komga-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` — Komga exécute ses propres migrations de schéma
  Flyway sur la base de données SQLite embarquée au premier démarrage (confirmé
  via les journaux de conteneurs locaux : `org.flywaydb.core.FlywayExecutor`,
  `Successfully validated 90 migrations`).
- **Assistant de configuration de première exécution.** Ouvrez l'URL du service
  et complétez l'assistant de configuration à `/` pour créer
  l'utilisateur administrateur initial — il n'y a pas de
  informations d'identification pré-remplies ni de chemin API/CLI pour en créer
  un de manière non interactive.
- **Ajoutez une bibliothèque après la première connexion.** Une fois connecté,
  ajoutez une "bibliothèque" pointant vers un chemin de média monté (voir
  `gcs_volumes` pour un stockage supplémentaire de bandes dessinées/livres
  en lecture seule) et déclenchez une analyse. Il s'agit d'une étape
  manuelle de l'opérateur ; aucun job d'initialisation ne la pré-remplit.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/actuator/health` (non authentifié, `200 {"status":"UP"}` une fois prêt).
  N'utilisez **pas** `/api/v1/actuator/health` — confirmé via des tests locaux pour
  renvoyer `401
  Unauthorized` même lorsque l'application est entièrement saine.
- **Bibliothèque partagée unique, instance unique.** La base de données SQLite
  de Komga est un fichier unique sur un volume monté — l'exécution de plus
  d'une instance risque de corrompre la base de données par des écritures
  concurrentes. Gardez `max_instance_count = 1`.
- **Dimensionnement du tas JVM.** Aucun plancher de mémoire officiel n'est
  documenté en amont ; le module définit `memory_limit = 1Gi` de manière
  conservatrice. Pour les très grandes bibliothèques (index Lucene lourd +
  cache de miniatures), augmentez `memory_limit` et définissez
  éventuellement `jvm_heap_max` pour lier explicitement le `-Xmx`
  de la JVM.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Komga sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `komga` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Komga` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image, transmis directement comme tag `gotson/komga`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `gotson/komga` — pas d'étape de build. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmenter pour les très grandes bibliothèques. |
| `min_instance_count` | `1` | Maintenir à `1` pour éviter les démarrages à froid pendant la reconstruction de l'index Lucene au démarrage. |
| `max_instance_count` | `1` | **Ne pas augmenter** — Komga sert une bibliothèque SQLite partagée. |
| `container_port` | `25600` | Port HTTP par défaut de Komga. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Komga n'a pas de Cloud SQL — conserver `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Komga dans Artifact Registry. |
| `jvm_heap_max` | `""` | `-Xmx` JVM optionnel via `JAVA_TOOL_OPTIONS` (par exemple `"512m"`, `"1g"`). |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface utilisateur de lecture. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'authentification propre à Komga. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

Non applicable — Komga n'a pas de base de données SQL. `enable_custom_sql_scripts` et les
variables associées sont déclarées uniquement pour la parité de convention.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Provisionne une instance Cloud Filestore (NFS) montée dans le service. Nécessite l'environnement d'exécution gen2. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires — par exemple, un bucket de bibliothèque de bandes dessinées/livres séparé en lecture seule, monté en lecture seule. Le bucket `storage` est monté à `/config` uniquement lorsque NFS n'est pas. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable — `database_type` est fixé à `NONE`. Toutes les variables
liées à la base de données sont déclarées pour la parité de convention et
transmises à la fondation sans effet.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga n'a pas besoin de job d'initialisation par défaut. |
| `cron_jobs` | `[]` | Jobs Cloud Scheduler + Cloud Run planifiés, par exemple pour les tâches de maintenance de bibliothèque. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/actuator/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/actuator/health` | Sonde structurée alternative. |
| `health_check_config` | HTTP `/actuator/health` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/actuator/health" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `komga_url` | URL VPC interne pour le service (uniquement accessible à l'intérieur du VPC lorsque `ingress_settings = "internal"`). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs de configuration (vides par défaut). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification. La
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critique | Plusieurs instances écrivant simultanément le même fichier SQLite risquent de corrompre la base de données. |
| Chemin de la sonde de santé | `/actuator/health` | Critique | `/api/v1/actuator/health` est protégé par authentification (401) — l'utiliser comme chemin de sonde signifie que la révision/le pod ne devient jamais prêt même si Komga est entièrement sain. |
| `enable_nfs` / `nfs_mount_path` | `true` / `/config` | Critique | Déplacer `/config` hors de NFS le place sur GCS FUSE (ou un disque éphémère), où les bases de données SQLite ne sont pas persistantes. |
| Assistant de configuration de première exécution | Terminer rapidement après le déploiement | Élevé | Un assistant de configuration non réclamé laisse l'instance sans compte administrateur ; toute personne qui atteint l'URL en premier peut le réclamer. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid, y compris une reconstruction de l'index Lucene à chaque démarrage à froid. |
| `memory_limit` | `1Gi`, augmenter pour les grandes bibliothèques | Moyen | Une mémoire sous-dimensionnée peut provoquer un OOM-kill lors d'une analyse de grande bibliothèque (index Lucene + cache de miniatures conservés dans le tas JVM). |
| `container_image_source` | `prebuilt` | Moyen | Passer à `custom` sans Dockerfile dans `Komga_Common/scripts` échoue la build — Komga n'a pas besoin de build personnalisée. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Komga partagée avec la variante GKE est décrite dans
**[Komga_Common](Komga_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Komga sur Cloud Run](../labs/Komga_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Komga sur GKE Autopilot](Komga_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Komga Common — Configuration d'application partagée](Komga_Common.md) — la configuration partagée par les deux cibles de déploiement.
