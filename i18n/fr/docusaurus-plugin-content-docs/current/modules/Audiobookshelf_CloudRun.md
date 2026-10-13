---
title: "Audiobookshelf sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Audiobookshelf sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Audiobookshelf_CloudRun.md @ e69407af sha256:6211c3eea0b4 -->

# Audiobookshelf sur Google Cloud Run {#audiobookshelf-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Audiobookshelf_CloudRun.png" alt="Audiobookshelf sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Audiobookshelf est un serveur d'audiobooks et de podcasts auto-hébergé — il organise votre bibliothèque audio, diffuse vers l'interface web et les applications mobiles officielles, et synchronise la progression d'écoute par utilisateur. Ce module déploie Audiobookshelf sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Audiobookshelf utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Audiobookshelf sur RAD, et comment cela se compare {#what-audiobookshelf-costs-on-rad-and-how-that-compares}

**Audiobookshelf sur le module Cloud Run de RAD coûte environ 19 US$ par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 40 crédits (4 US$ au prix de la recharge) dans un projet que vous possédez, et 36 crédits (10 % de moins) dans un projet géré par RAD. Si Audiobookshelf doit fonctionner en continu sur plusieurs pods ou à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](Audiobookshelf_GKE.md). Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les environ 19 US$ par mois deviennent presque nuls. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ 19 US$ par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **9 crédits par jour**, environ 270 par mois (environ 27 US$ au prix de la recharge, 22 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (add-ons, sauvegardes) | 1 US$ |
| **Total** | **environ 19 US$** |

### Comment cela se compare {#how-it-compares}

- **Aucun concurrent SaaS de marque n'est un équivalent parfait pour Audiobookshelf, donc la comparaison honnête est un simple serveur auto-géré.** C'est une charge de travail plus petite qu'un VPS standard de 2 vCPU, donc le faire fonctionner vous-même sur une classe moins chère et plus petite qu'un Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go Droplet (tous deux environ 24 $/mois) ferait l'affaire, pour nettement moins que cela.
- **RAD n'est pas moins cher qu'un VPS nu en termes monétaires, et n'essaie pas de l'être.** Ce que RAD ajoute pour un prix similaire est une base de données gérée, Secret Manager pour les identifiants, et une surveillance que vous auriez autrement à configurer, patcher et sauvegarder vous-même.
- **Le temps de l'administrateur est le coût réel qu'un VPS ne montre pas.** Les correctifs de sécurité, les sauvegardes et les mises à niveau de version sur un serveur nu sont un travail que quelqu'un doit continuer à faire ; les services gérés de RAD absorbent cela.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Audiobookshelf fonctionne dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet, et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que de faire fonctionner Audiobookshelf en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 US$), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des études et des démos). Google indique que la plupart des services sont à nouveau pleinement opérationnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'Audiobookshelf écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement, et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 45 crédits (environ 4,50 US$) dans votre propre projet, ou 41 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'Audiobookshelf resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût de fonctionnement — environ 7 jours ou plus dans votre propre projet (0,64 US$/jour) ou 5 jours ou plus dans un projet géré par RAD (9 crédits/jour).
- **Conservez d'abord vos données.** Tout ce qu'Audiobookshelf écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Audiobookshelf dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Audiobookshelf pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Audiobookshelf fonctionne comme un conteneur Node.js sur Cloud Run v2. Fait inhabituel pour ce catalogue, il ne nécessite **aucune base de données externe, aucun Redis et aucun secret d'application** — l'empreinte du déploiement est délibérément petite :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, épinglé à une seule instance |
| Base de données | Aucune | Audiobookshelf intègre sa propre base de données SQLite sous `/data/config` — pas de Cloud SQL |
| État persistant | Cloud Storage (GCS FUSE) | Un bucket dédié `storage` monté à `/data` (gen2 requis) |
| Image de conteneur | Cloud Build + Artifact Registry | Wrapper léger construit `FROM ghcr.io/advplyr/audiobookshelf` et mis en miroir dans votre registre |
| Secrets | Secret Manager | Pas de secrets d'application — l'utilisateur admin est créé dans l'interface web lors de la première exécution |
| Ingress | URL Cloud Run / Cloud Load Balancing | **Par défaut à `all`** (internet public) ; équilibreur de charge HTTPS externe optionnel |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type = "NONE"` et `enable_cloudsql_volume = false` sont fixés par `Audiobookshelf_Common` ; Audiobookshelf crée et migre sa base de données SQLite interne au premier démarrage. Aucun job `db-init` n'est exécuté.
- **Un montage persistant couvre tout.** `CONFIG_PATH = /data/config` (base de données SQLite + configuration de l'application) et `METADATA_PATH = /data/metadata` (illustrations de couverture, métadonnées mises en cache) sont tous deux redirigés sous `/data`, qui est soutenu par un bucket GCS provisionné automatiquement monté via GCS FUSE. La perte de ce bucket entraîne la perte de tout l'état d'Audiobookshelf.
- **Instance unique.** `min_instance_count = 1` et `max_instance_count = 1` — une bibliothèque SQLite partagée doit être servie par exactement un rédacteur. N'augmentez pas le maximum.
- **L'ingress est par défaut `all`.** L'URL `run.app` est publiquement accessible depuis un navigateur dès la sortie de la boîte, correspondant à la valeur par défaut de la fondation `App_CloudRun`. Définissez `ingress_settings = "internal"` (ou placez le service derrière l'équilibreur de charge) pour le verrouiller à un accès uniquement VPC.
- **Image personnalisée (wrapper léger).** Cloud Build enveloppe l'image amont `ghcr.io/advplyr/audiobookshelf` afin qu'elle soit mise en miroir dans Artifact Registry. Le Dockerfile lit l'ARG de build spécifique à l'application `AUDIOBOOKSHELF_VERSION` ; `application_version = "latest"` se résout en `2.17.0` épinglé.
- **Pas de secrets générés.** L'utilisateur **root** initial est créé interactivement dans l'interface web de première exécution, et les jetons API sont générés dans l'interface utilisateur par la suite — `Audiobookshelf_Common` expose `secret_ids` vide.
- **Les sondes de santé ciblent `/healthcheck`**, le point de terminaison non authentifié 200 d'Audiobookshelf (démarrage : délai initial de 15 s, 10 échecs autorisés ; vivacité : délai de 30 s, 3 échecs).
- **Pas de Redis.** `enable_redis` est explicitement forcé à `false` dans l'appel de la fondation.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Audiobookshelf {#a-cloud-run--the-audiobookshelf-service}

Audiobookshelf fonctionne comme un service Cloud Run v2 épinglé à une seule instance. Chaque déploiement crée une révision immuable ; le trafic se déplace vers la plus récente et saine.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et le partage de trafic.

### B. Cloud Storage — le bucket d'état `/data` {#b-cloud-storage--the-data-state-bucket}

Tout l'état d'Audiobookshelf — la base de données SQLite, la configuration de l'application, les illustrations de couverture et les métadonnées mises en cache — se trouve sous `/data`, soutenu par un bucket **Cloud Storage** dédié (suffixe `storage`) monté dans le conteneur via **GCS FUSE**. L'environnement d'exécution gen2 est requis pour les montages FUSE. Des buckets multimédias supplémentaires (par exemple, une bibliothèque d'audiobooks en lecture seule) peuvent être attachés via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  gcloud storage ls gs://<storage-bucket>/config/   # SQLite DB + app config
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et CMEK.

### C. Cloud Build et Artifact Registry — l'image de conteneur {#c-cloud-build--artifact-registry--the-container-image}

Le module construit une image wrapper légère `FROM ghcr.io/advplyr/audiobookshelf:${AUDIOBOOKSHELF_VERSION}` via Cloud Build et la stocke dans l'Artifact Registry du locataire, isolant les déploiements des limites de débit du registre amont et épinglant la version.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Audiobookshelf lui-même n'a pas besoin de secrets injectés — il n'y a pas de mot de passe de base de données, de clé maîtresse ou de secret JWT. Secret Manager reste disponible pour tout `secret_environment_variables` personnalisé que vous ajoutez.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut `ingress_settings = "all"` — le service est publiquement accessible, correspondant à la valeur par défaut de la fondation `App_CloudRun`. Définissez `ingress_settings = "internal"` pour restreindre le service aux appelants à l'intérieur du VPC, ou activez l'équilibreur de charge HTTPS externe (`enable_cloud_armor`) avec un domaine personnalisé pour une configuration frontale.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring, avec un test de disponibilité optionnel (désactivé par défaut — il ne peut réussir que sur un point de terminaison publiquement accessible) et des politiques d'alerte.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Audiobookshelf {#3-audiobookshelf-application-behaviour}

- **Premier démarrage autonome.** Au premier démarrage, Audiobookshelf crée sa base de données SQLite et sa structure de répertoires sous `CONFIG_PATH`/`METADATA_PATH` — aucun job d'initialisation, job de migration ou provisionnement de base de données n'est impliqué. Étant donné que les deux chemins se trouvent sous le montage persistant `/data`, la base de données survit aux déploiements de révisions, aux mises à niveau de version et aux événements de mise à l'échelle.
- **Assistant de configuration de première exécution.** Ouvrez l'URL du service (`/`) — Audiobookshelf vous invite à créer l'utilisateur **root** initial de manière interactive. Il n'y a pas de démarrage administrateur basé sur l'environnement ; les jetons API sont générés dans l'interface web par la suite.
- **Écriture unique.** SQLite sur un montage FUSE partagé tolère exactement un rédacteur. Le module épingle `min_instance_count = 1` / `max_instance_count = 1` ; l'exécution de réplicas sur le même `/data` risque une corruption de la base de données.
- **Point de terminaison de santé.** `/healthcheck` renvoie HTTP 200 non authentifié une fois le serveur prêt ; il prend en charge la sonde de démarrage (délai initial de 15 s, jusqu'à ~115 s de grâce), la sonde de vivacité et le test de disponibilité optionnel. L'interface web est à `/`.
- **Mise en garde sur la latence de GCS FUSE.** Un serveur multimédia souhaite idéalement un stockage par blocs pour sa base de données SQLite et ses analyses de bibliothèque. GCS FUSE convient pour une utilisation légère à modérée ; pour les bibliothèques volumineuses ou de production, préférez `Audiobookshelf_GKE`, qui monte un véritable PVC par blocs à `/data`.
- **CLI de vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~audiobookshelf" --format="value(metadata.name)" --limit=1)
  URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$URL/healthcheck"   # expect 200 (ingress "all")
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Audiobookshelf sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `audiobookshelf` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image ; `latest` construit le `2.17.0` épinglé. Modifier pour déclencher une nouvelle construction et un nouveau déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU par instance. Les analyses de bibliothèque et le travail de métadonnées intégrées sont liés au CPU — augmentez la taille pour les importations importantes. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmentez la taille pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Maintient une instance chaude ; l'état SQLite est sur GCS donc `0` est sûr pour les données mais ajoute des démarrages à froid. |
| `max_instance_count` | `1` | **Gardez à 1** — une bibliothèque SQLite, un rédacteur. |
| `container_port` | `80` | Port HTTP d'Audiobookshelf (`PORT=80` est injecté pour correspondre). |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE `/data`. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — gardez `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image amont dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut. Définissez `internal` (ou utilisez l'équilibreur de charge) pour restreindre l'interface web et les applications mobiles à un accès uniquement VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionné sur les valeurs par défaut du module `CONFIG_PATH=/data/config`, `METADATA_PATH=/data/metadata`. Aucune valeur par défaut `PORT` n'est définie — Audiobookshelf écoute sur le `$PORT` auto-injecté de Cloud Run, et une variable d'environnement `PORT` fournie par l'utilisateur est un nom réservé que la plateforme rejette. Ne modifiez pas les deux chemins après le premier démarrage. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (aucun requis par Audiobookshelf). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | off / `gcs` / `""` / `tar` | Restaurer à partir d'une sauvegarde lors du déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts` et ses compagnons ne sont **pas applicables** — Audiobookshelf n'a pas de base de données SQL. Laissez-les à leurs valeurs par défaut.

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` / `application_domains` / `enable_cdn` | off / `[]` / `false` | Équilibreur de charge HTTPS externe avec WAF, domaine personnalisé et CDN — la méthode recommandée pour exposer Audiobookshelf publiquement. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `/data` `storage` est provisionné automatiquement — laissez-le activé. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires, par exemple un bucket de bibliothèque multimédia en lecture seule. Le bucket `storage` à `/data` est toujours ajouté. |
| `enable_nfs` | `false` | Montage Filestore optionnel ; non nécessaire pour la disposition par défaut. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

`database_type` est fixé à `NONE` par `Audiobookshelf_Common` ; les autres entrées de base de données (`database_password_length`, paramètres de rotation, `db_*_env_var_name`) sont transmises uniquement pour la compatibilité de la fondation et n'ont aucun effet.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation par défaut — Audiobookshelf s'initialise lui-même. Fournissez des jobs uniquement pour des tâches ponctuelles personnalisées. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, délai initial de 15 s, 10 échecs | Permet environ 115 s de grâce au premier démarrage. |
| `liveness_probe` | HTTP `/healthcheck`, délai initial de 30 s, 3 échecs | Redémarre une instance bloquée. |
| `uptime_check_config` | désactivé, chemin `/healthcheck` | Activer uniquement lorsque le point de terminaison est publiquement accessible. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite des autorisations au niveau de l'organisation). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `audiobookshelf_url` | URL de l'interface web / API. Publiquement accessible par défaut (`ingress_settings = "all"`) ; uniquement interne au VPC si `ingress_settings` est changé en `"internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `/data` `storage`). |
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
| `max_instance_count` | `1` | Critique | Plusieurs instances écrivent dans la même base de données SQLite via le montage FUSE partagé — corruption de la base de données. |
| `create_cloud_storage` / le bucket `storage` | conserver provisionné | Critique | `/data` contient *tout* l'état (base de données SQLite, configuration, métadonnées). La suppression du bucket entraîne la perte de toute la configuration de la bibliothèque. |
| `CONFIG_PATH` / `METADATA_PATH` remplacements | laisser les valeurs par défaut | Critique | Les modifier après le premier démarrage orpheline la base de données SQLite existante et les métadonnées mises en cache. |
| `container_port` | `80` | Critique | Audiobookshelf écoute sur le `$PORT` auto-injecté de Cloud Run, dérivé de `container_port=80` (aucune variable d'environnement `PORT` explicite n'est définie — c'est un nom réservé que Cloud Run rejette) ; une non-concordance `container_port` échoue à chaque sonde de santé. |
| `execution_environment` | `gen2` | Élevé | Les montages GCS FUSE nécessitent gen2 ; gen1 ne peut pas monter le bucket `/data`. |
| `enable_backup_import` | `false` sauf en cas de restauration | Élevé | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `ingress_settings` | `all` (par défaut) / `internal` si nécessaire | Moyen | Le `all` par défaut est publiquement accessible ; définissez `internal` (ou ajoutez l'équilibreur de charge) uniquement si vous souhaitez spécifiquement verrouiller le service à un accès uniquement VPC. |
| `application_version` | tag épinglé | Moyen | `latest` se résout silencieusement au `2.17.0` épinglé ; épinglez explicitement pour contrôler les mises à niveau. |
| `min_instance_count` | `1` | Moyen | `0` économise des coûts (l'état est sur GCS, donc il est sûr pour les données) mais ajoute un démarrage à froid au premier flux après l'inactivité. |
| Taille de la bibliothèque sur GCS FUSE | petites/moyennes bibliothèques | Moyen | Les grandes bibliothèques et les analyses fréquentes souffrent de la latence FUSE — utilisez `Audiobookshelf_GKE` (PVC par blocs) pour les bibliothèques à l'échelle de la production. |
| `enable_cloudsql_volume` | `false` | Faible | Aucune base de données Cloud SQL n'existe ; l'activation gaspille un sidecar. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Audiobookshelf partagée avec la variante GKE est décrite dans **[Audiobookshelf_Common](Audiobookshelf_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Audiobookshelf sur Cloud Run](../labs/Audiobookshelf_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Audiobookshelf Common — Configuration d'application partagée](Audiobookshelf_Common.md) — la configuration partagée par les deux cibles de déploiement.
