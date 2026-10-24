---
title: "ActualBudget sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'ActualBudget sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ActualBudget_CloudRun.md @ 1665a43e sha256:fffa64dbbe81 -->

# ActualBudget sur Google Cloud Run {#actualbudget-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ActualBudget_CloudRun.png" alt="ActualBudget sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Actual Budget est une application de finances personnelles axée sur la confidentialité et le local-first, construite autour de la budgétisation par enveloppes à base zéro. Le composant `actual-server` est un serveur de synchronisation Node.js léger qui stocke chaque budget sous forme de fichier SQLite et le synchronise entre l'interface web, les clients de bureau et mobiles. Ce module déploie le serveur Actual Budget sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'ActualBudget utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte ActualBudget sur RAD, et comment cela se compare {#what-actualbudget-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'ActualBudget sur RAD coûte environ 19 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 40 crédits (4 $ US au prix de la recharge) dans un projet que vous possédez, et de 36 crédits (10 % de moins) dans un projet géré par RAD. Si ActualBudget doit fonctionner en continu sur plusieurs pods ou à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](ActualBudget_GKE.md). Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 19 $ US par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 19 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **9 crédits par jour**, environ 270 par mois (environ 27 $ US au prix de la recharge, 22 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (chaud) | 13,14 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 19 $ US** |

### Comment cela se compare {#how-it-compares}

- YNAB (You Need A Budget), l'application de budgétisation payante la plus connue dans la même catégorie, facture **14,99 $/mois** (ou 109 $/an, soit environ 9,08 $/mois) par personne — et il s'agit d'une redevance de licence pour le logiciel uniquement, sans infrastructure propre derrière.
- **RAD exécute le projet open-source lui-même, et non une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sur votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par utilisateur ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** C'est une charge de travail plus petite qu'un VPS standard de 2 vCPU, donc l'exécuter vous-même sur une classe moins chère et plus petite qu'un Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go Droplet (tous deux environ 24 $/mois) ferait l'affaire, pour nettement moins que cela. RAD n'est pas moins cher en termes monétaires — la différence est la base de données gérée, Secret Manager et la surveillance qui viennent avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si ActualBudget fonctionne dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet, et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — pour préparer une certification, une démo, un besoin saisonnier — que de faire fonctionner ActualBudget en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes ne survivent pas.** Tout ce qu'ActualBudget écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement, et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 45 crédits (environ 4,50 $ US) dans votre propre projet, ou 41 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'ActualBudget resterait inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 7 jours ou plus dans votre propre projet (0,64 $ US/jour) ou 5 jours ou plus dans un projet géré par RAD (9 crédits/jour).
- **Gardez vos données en premier.** Tout ce qu'ActualBudget écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lors du redéploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'ActualBudget dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute ActualBudget pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification YNAB](https://www.ynab.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

ActualBudget s'exécute comme un conteneur Node.js unique sur Cloud Run v2. Comme il gère son propre stockage SQLite, le déploiement relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 Gio par défaut, instance unique (`min = max = 1`) |
| Base de données | Aucune | ActualBudget conserve les données budgétaires dans des fichiers SQLite — `database_type = "NONE"`, pas de Cloud SQL |
| Données persistantes | Cloud Storage (GCS FUSE) | Un bucket `storage` dédié monté à `/data` contient les fichiers de budget SQLite et les fichiers utilisateur |
| Image de conteneur | Artifact Registry + Cloud Build | Build thin-wrapper de `actualbudget/actual-server`, mis en miroir dans votre registre |
| Secrets | Secret Manager | Un jeton API (`enable_api_key`), **activé par défaut** et requis chaque fois que `ingress_settings = "all"` |
| Ingress | URL Cloud Run / Cloud Load Balancing | **Par défaut à `all`** (public) — nécessaire pour atteindre directement l'interface web ; passez à `internal` pour un accès uniquement VPC |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** ActualBudget persiste tout sous forme de fichiers SQLite sous `/data` ; il n'y a pas d'instance Cloud SQL, pas de job `db-init`, pas de Redis (`enable_redis = false`), et pas de sidecar Cloud SQL Auth Proxy.
- **Un bucket GCS `storage` est provisionné automatiquement** par `ActualBudget_Common` et monté à `/data` via GCS FUSE (`enable_gcs_storage_volume = true`). `ACTUAL_SERVER_FILES = /data/server-files` et `ACTUAL_USER_FILES = /data/user-files` pointent les deux sous-arborescences de persistance vers ce montage afin que rien ne se retrouve sur un disque de conteneur éphémère.
- **Instance unique par conception.** `min_instance_count = 1` et `max_instance_count = 1` — le serveur sert un ensemble partagé de fichiers SQLite à partir d'un seul volume ; l'exécution de plusieurs réplicas risque des conflits d'écriture.
- **L'ingress est par défaut `all` (public), associé à une clé API obligatoire.** `ingress_settings = "all"` est la valeur par défaut du module — nécessaire pour atteindre directement l'interface web — et `validation.tf` applique une précondition au moment de la planification (`ingress_settings != "all" || enable_api_key`) qui rejette l'ingress public à moins que `enable_api_key` ne soit également `true`. Comme `enable_api_key` est également par défaut `true`, les valeurs par défaut pures passent la validation et se déploient publiquement accessibles avec une protection par jeton API déjà provisionnée. Passez à `ingress_settings = "internal"` pour un accès uniquement VPC à la place.
- **Clé API activée par défaut.** Le mot de passe du serveur est toujours défini interactivement sur l'écran d'intégration de la première exécution, mais `enable_api_key = true` (la valeur par défaut du module) provisionne en outre un jeton API de 32 caractères (`ACTUAL_TOKEN`) dans Secret Manager — requis par la précondition d'ingress ci-dessus chaque fois que `ingress_settings = "all"`.
- **Verrouillage de version.** Le Dockerfile lit un ARG de build `ACTUALBUDGET_VERSION` spécifique à l'application ; `application_version = "latest"` verrouille le build à `25.7.1`.
- **Les sondes de santé ciblent `/`** — le serveur répond à son chemin racine avec HTTP 200 dès qu'il écoute, aucune authentification requise.
- **Mieux adapté à un usage mono-utilisateur / léger sur Cloud Run.** SQLite sur GCS FUSE ne tolère pas les écritures concurrentes lourdes ; pour un stockage de production durable, préférez la variante ActualBudget_GKE avec un PVC de bloc.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service ActualBudget {#a-cloud-run--the-actualbudget-service}

ActualBudget s'exécute en tant que service Cloud Run v2 épinglé à une seule instance. Chaque déploiement crée une révision immuable ; le trafic bascule vers la révision saine la plus récente lors de la mise à jour.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — la couche de données persistantes {#b-cloud-storage--the-persistent-data-tier}

Tout l'état d'ActualBudget — les bases de données de budget SQLite, les fichiers du serveur et les données utilisateur par fichier — réside sur un bucket **Cloud Storage** dédié monté dans le conteneur à `/data` via **GCS FUSE** (environnement d'exécution gen2 requis). Le bucket survit aux déploiements de révisions, aux redémarrages et aux redéploiements ; c'est le seul endroit où les données budgétaires existent, alors traitez-le comme la chose à protéger et à sauvegarder.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
  gcloud storage ls -r gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le comportement de montage GCS Fuse et CMEK.

### C. Artifact Registry & Cloud Build — l'image de conteneur {#c-artifact-registry--cloud-build--the-container-image}

`ActualBudget_Common` livre un Dockerfile thin-wrapper (`FROM actualbudget/actual-server:${ACTUALBUDGET_VERSION}`) que Cloud Build transforme en image dans le dépôt Artifact Registry de votre projet — ainsi les déploiements tirent de votre registre, pas de Docker Hub, et sont compatibles avec Binary Authorization.

- **Console :** Artifact Registry → Repositories ; Cloud Build → History.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  ```

### D. Secret Manager — jeton API {#d-secret-manager--api-token}

`enable_api_key = true` est la valeur par défaut du module : un jeton aléatoire de 32 caractères est généré, stocké dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key`, et injecté dans le service en tant que variable d'environnement secrète `ACTUAL_TOKEN` — utile pour les automatisations qui doivent appeler le serveur avant que l'interface utilisateur ne soit configurée, et requis par `validation.tf` chaque fois que `ingress_settings = "all"` (également la valeur par défaut).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est par défaut `ingress_settings = "all"`, de sorte que l'URL `run.app` est publiquement accessible dès la sortie de la boîte (nécessaire pour atteindre directement l'interface web) — associé à la valeur par défaut obligatoire `enable_api_key = true` (voir §2.D). Pour un accès uniquement VPC, définissez `ingress_settings = "internal"` ; pour un domaine personnalisé, Cloud CDN, Cloud Armor, et éventuellement IAP en amont, utilisez `internal-and-cloud-load-balancing`.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  # Tunnel to an internal-only service from your workstation:
  gcloud run services proxy <service-name> --region "$REGION" --port 8080
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring. Une vérification de disponibilité peut être activée via `uptime_check_config` (désactivée par défaut ; elle nécessite un point de terminaison publiquement accessible — satisfait par défaut par `ingress_settings = "all"`, mais pas si vous passez à `internal`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application ActualBudget {#3-actualbudget-application-behaviour}

- **Pas de job d'initialisation.** Il n'y a pas de base de données à amorcer ; le serveur crée ses fichiers SQLite sous `/data` au premier démarrage. Des `initialization_jobs` personnalisés sont acceptés pour les tâches de chargement ou de migration de données, mais aucun n'est fourni par défaut.
- **Configuration initiale.** Lors du premier accès, l'interface web affiche un écran d'intégration où vous définissez le **mot de passe du serveur** — il n'y a pas de identifiants pré-remplis à récupérer. Faites-le immédiatement après le déploiement ; le service est publiquement accessible par défaut (`ingress_settings = "all"`), et tant qu'un mot de passe n'est pas défini, toute personne pouvant atteindre l'URL peut s'approprier le serveur.
- **Disposition des données.** `ACTUAL_SERVER_FILES = /data/server-files` (métadonnées du serveur et base de données du compte) et `ACTUAL_USER_FILES = /data/user-files` (données de synchronisation par budget). Les deux résident sur le montage GCS FUSE, de sorte que les données budgétaires survivent aux redémarrages et aux redéploiements.
- **Modèle de synchronisation local-first.** Les clients (web, bureau, mobile) conservent une copie locale complète du budget et n'utilisent le serveur que pour synchroniser les modifications chiffrées entre les appareils — une brève indisponibilité du serveur ne bloque pas le travail dans un client.
- **Contrainte d'écrivain unique.** Le serveur suppose un accès exclusif à ses fichiers SQLite. Gardez `max_instance_count = 1` ; une validation au moment de la planification applique `min_instance_count <= max_instance_count`.
- **Mises à jour de version.** Modifiez `application_version` et réappliquez — Cloud Build produit une nouvelle image et Cloud Run déploie une nouvelle révision. `latest` construit le `25.7.1` épinglé.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité émettent `GET /`, qui renvoie HTTP 200 non authentifié dès que le serveur HTTP écoute.
- **Vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200 with the default ingress=all (403/404 if switched to internal)
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour ActualBudget sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `actualbudget` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` construit le `25.7.1` épinglé. Incrémentez pour déclencher un nouveau build et une nouvelle révision. |
| `enable_api_key` | `true` | Génère un jeton API de 32 caractères dans Secret Manager et l'injecte en tant que `ACTUAL_TOKEN`. Requis chaque fois que `ingress_settings = "all"` (la valeur par défaut du module) — `validation.tf` rejette l'ingress public sans lui. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | actual-server est un processus Node.js léger ; 1 vCPU suffit. |
| `memory_limit` | `1Gi` | Une mémoire modeste est suffisante pour les fichiers de budget typiques. |
| `min_instance_count` | `1` | Maintient l'instance unique chaude. Définissez `0` pour une mise à l'échelle à zéro si un démarrage à froid à la première requête est acceptable. |
| `max_instance_count` | `1` | **Gardez à 1** — un volume SQLite partagé, un écrivain. |
| `container_port` | `5006` | Port HTTP natif d'actual-server. |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE `/data`. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — laissez `false`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut (nécessaire pour atteindre directement l'interface web) ; `validation.tf` requiert `enable_api_key = true` lorsque ceci est `all`. Définissez `internal` pour un accès uniquement VPC, ou `internal-and-cloud-load-balancing` derrière un équilibreur de charge HTTPS. |
| `enable_iap` | `false` | Ajoute l'authentification Google-identity devant l'interface utilisateur (chemin de l'équilibreur de charge). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en clair. `ACTUAL_PORT`, `ACTUAL_SERVER_FILES` et `ACTUAL_USER_FILES` sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires. Le secret `ACTUAL_TOKEN` est automatiquement câblé lorsque `enable_api_key = true`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 7-10 — Sauvegarde, CI/CD, SQL personnalisé, Domaine et CDN {#groups-710--backup-cicd-custom-sql-domain--cdn}

Comportement standard d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Notez que les entrées SQL personnalisées (groupe 9) sont inertes pour ActualBudget car il n'y a pas d'instance Cloud SQL.

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket de données `storage` est toujours déclaré par `ActualBudget_Common`. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le montage de stockage `/data` est ajouté automatiquement. |
| `enable_nfs` | `false` | Non nécessaire — la persistance est sur le bucket GCS. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par `ActualBudget_Common` — ActualBudget n'a pas de base de données SQL. |

Toutes les autres entrées de ce groupe sont transmises pour compatibilité mais ne sont pas référencées.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job par défaut. Fournissez le vôtre uniquement pour le chargement/la migration de données personnalisées. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 15 s de délai initial, 10 échecs | Passe dès que le serveur Node écoute. |
| `liveness_probe` | HTTP `/`, 30 s de délai initial, période 30 s | Chemin racine, non authentifié. |
| `uptime_check_config` | désactivé | N'activez qu'une fois le point de terminaison publiquement accessible (ingress `all` ou un équilibreur de charge). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging` — comportement standard d'App_CloudRun ; voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `actualbudget_url` | L'URL `run.app` du service. Publiquement accessible par défaut (`ingress_settings = "all"`) ; restreint au VPC lorsque `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket de stockage `/data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

Le module inclut une validation au moment de la planification pour les erreurs de configuration les plus dommageables (par exemple `min_instance_count <= max_instance_count`), mais plusieurs paramètres méritent une attention particulière :

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Plusieurs instances écrivent les mêmes fichiers SQLite sur un volume partagé — risque de corruption/conflit. |
| Mot de passe du serveur à la première exécution | défini immédiatement | Critique | Tant qu'un mot de passe n'est pas défini, toute personne pouvant atteindre l'URL peut s'approprier le serveur et ses données budgétaires. |
| Contenu du bucket de stockage | ne jamais supprimer manuellement | Critique | `/data` sur le bucket GCS est la seule copie des bases de données de budget ; la suppression du bucket efface tous les budgets. |
| `container_port` | `5006` | Critique | Port natif d'actual-server ; une non-concordance entraîne l'échec de toutes les sondes de santé. |
| `execution_environment` | `gen2` | Élevé | Les montages de volume GCS FUSE nécessitent gen2 ; gen1 laisse `/data` non monté et les données sur disque éphémère. |
| `ingress_settings` = `"all"` (par défaut) | définir le mot de passe du serveur immédiatement après le déploiement | Critique | Le service est publiquement accessible par défaut ; un serveur non réclamé peut être réclamé par quiconque atteint l'URL en premier. Définissez `internal` à la place si l'accès public n'est pas nécessaire. |
| `ingress_settings = "all"` avec `enable_api_key = false` | pas une combinaison valide | Critique | `validation.tf` applique `ingress_settings != "all" \|\| enable_api_key` au moment de la planification — cette combinaison échoue carrément la planification plutôt que de déployer de manière non sécurisée. Les deux sont par défaut à des valeurs qui satisfont déjà la précondition (`all` + `true`), donc les valeurs par défaut pures se déploient proprement ; seul un remplacement explicite par `enable_api_key = false` tout en laissant l'ingress à `all` déclenche l'échec. |
| Charge d'écriture multi-utilisateur lourde | passer à ActualBudget_GKE (PVC de bloc) | Élevé | SQLite ne tolère pas GCS FUSE sous une écriture concurrente lourde ; Cloud Run convient à un usage mono-utilisateur / léger. |
| `enable_api_key` | `true` (par défaut) | Moyen | Sans `ACTUAL_TOKEN`, l'accès API programmatique repose uniquement sur le mot de passe du serveur. Également requis par la précondition d'ingress ci-dessus chaque fois que `ingress_settings = "all"`. |
| `min_instance_count` | `1` (ou `0` pour économiser des coûts) | Moyen | `0` ajoute un démarrage à froid à la première requête après l'inactivité ; les données sont sûres dans tous les cas (l'état est sur GCS). |
| `uptime_check_config` | activer lorsque l'ingress est public | Faible | Si `ingress_settings` est basculé sur `internal`, la vérification ne peut pas atteindre le service et échouera toujours. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à ActualBudget partagée avec la variante GKE est décrite dans **[ActualBudget_Common](ActualBudget_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : ActualBudget sur Cloud Run](../labs/ActualBudget_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ActualBudget sur GKE Autopilot](ActualBudget_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [ActualBudget Common — Configuration d'application partagée](ActualBudget_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md), [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md), [Wallos sur Google Cloud Run](Wallos_CloudRun.md) dans la solution **Finance et suivi de patrimoine**.
