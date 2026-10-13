---
title: "Homepage sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Homepage sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Homepage_CloudRun.md @ e69407af sha256:6dbbae726907 -->

# Homepage sur Google Cloud Run {#homepage-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homepage_CloudRun.png" alt="Homepage sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Homepage](https://gethomepage.dev/) (gethomepage/homepage) est un tableau de
bord d'application/lanceur de services auto-hébergé et hautement
personnalisable — une application Next.js 16 / Node 22 dont toute la
configuration (services, favoris, widgets, mise en page) réside dans une
poignée de fichiers YAML, avec des widgets optionnels de statut/statistiques
en direct pour d'autres applications auto-hébergées que vous exécutez. Ce
module déploie Homepage sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Homepage et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Homepage sur RAD, et comment cela se compare {#what-homepage-costs-on-rad-and-how-that-compares}

**L'exécution de Homepage sur Cloud Run dans votre propre projet Google Cloud coûte environ 16,78 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 40 crédits facturé une fois au moment du déploiement. Homepage est l'application la plus légère de ce lot, de loin — un tableau de bord statique sans base de données propre — de sorte que son coût d'exécution dans votre propre projet est proche du plancher de ce que coûte tout déploiement Cloud Run. Dans un projet géré par RAD, les frais de module tombent à 36 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](Homepage_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 40 crédits | 36 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 16,78 $/mois, facturé par Google au prix catalogue | ~3 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **16,78 $** |

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — nettement plus qu'un tableau de bord uniquement configuré sans besoin de base de données ; une micro-instance à vCPU partagé de 5 à 6 $/mois de l'un de ces mêmes fournisseurs l'exécuterait confortablement.
- Homepage n'a pas de SaaS commercial hébergé propre — il est distribué uniquement en tant que logiciel auto-hébergé configuré en YAML.
- Comme il n'y a pas de base de données ou de serveur de fichiers ici, l'écart entre un projet géré par RAD et un VPS nu est plus petit que pour presque tout le reste de ce lot — principalement juste le TLS géré, Secret Manager et la surveillance par rapport à le faire à la main.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne **détruit pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer
le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
typique de 2-3 déploiements.

Ce dont cela a besoin : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude/démo). Google affirme que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Homepage et souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et ramener Homepage signifie redéployer à partir de
zéro. Cela coûte environ 43-46 crédits (les 40 crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si Homepage reste inutilisé suffisamment longtemps pour que le coût de redéploiement
soit inférieur à son propre coût d'exécution — pour Homepage, cela représente environ 8 jours ou
plus.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin,
le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Homepage s'exécute en tant que conteneur Node.js/Next.js unique sur Cloud Run v2. Contrairement à
presque tous les autres modules de ce catalogue, il n'a **pas de base de données et pas de
cache** — son état entier est un répertoire de fichiers YAML :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Processus Node.js unique, `1000m` CPU / `512Mi` mémoire par défaut |
| Base de données | aucune | Homepage n'a aucune base de données ; `database_type = "NONE"` |
| Stockage d'objets | Cloud Storage | Un bucket `storage` monté à `/app/config` via GCS FUSE — contient tous les fichiers de configuration YAML (`settings.yaml`, `services.yaml`, `bookmarks.yaml`, `widgets.yaml`, `docker.yaml`) plus les journaux |
| Cache et file d'attente | aucun | `enable_redis = false` est codé en dur dans `main.tf`, remplaçant la valeur par défaut de la fondation `true` |
| Secrets | aucun | Aucun secret n'est généré — Homepage n'a pas besoin de ses propres identifiants |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Véritablement pré-construit — pas d'image personnalisée, pas de Cloud Build pour l'application.**
  `Homepage_Common` définit `image_source = "prebuilt"` et
  `container_build_config.enabled = false` ; `ghcr.io/gethomepage/homepage` est
  déployé directement. `enable_image_mirroring = true` le copie toujours dans
  Artifact Registry (évite les limites de débit de GHCR), mais c'est un miroir, pas un
  build.
- **Port 3000, chemin de santé `/api/healthcheck`.** Confirmé via un déploiement
  en direct : `GET /api/healthcheck` renvoie un `200 "up"` non authentifié
  une fois l'application prête (soutenu par la directive `HEALTHCHECK` de l'image).
- **Pas de base de données, pas de Redis — architecturalement inhabituel pour ce catalogue.**
  Presque tous les autres modules d'application connectent une instance Cloud SQL et/ou
  Redis via la fondation ; Homepage n'a besoin ni de l'un ni de l'autre. Cela signifie également qu'il
  n'a aucune des classes de bogues habituelles de câblage DSN, socket-vs-TCP, ou d'encodage d'URL de mot de passe
  documentées ailleurs dans ce dépôt — il n'y a tout simplement pas de connexion à la base de données à mal faire.
- **La mise à l'échelle à zéro et les instances multiples sont toutes deux réellement sûres.** Homepage
  lit sa configuration YAML en direct depuis le disque à chaque requête (pas de cache en cours de processus),
  et son auto-amorçage de configuration unique au premier démarrage est idempotent. Le
  module utilise par défaut `min_instance_count = 0` / `max_instance_count = 3` —
  la plupart des applications avec état de ce catalogue ont besoin de l'inverse (`min = 1`,
  `max = 1`) pour éviter la perte au démarrage à froid ou une course à l'écriture unique ; Homepage n'a
  besoin d'aucune de ces protections.
- **Pas d'authentification propre.** `HOMEPAGE_ALLOWED_HOSTS` par défaut
  `"*"` — cela ne filtre que la vérification de l'en-tête `Host` sur les appels de données de widget `/api/*` de Homepage,
  pas un véritable contrôle d'accès. Placez-le derrière IAP, un VPN ou un proxy inverse
  si vous devez restreindre qui peut y accéder.
- **Une option de montage GCS FUSE documentée et vérifiée sur Cloud Run.**
  `Homepage_Common` demande `uid=1000,gid=1000` dans le
  `mount_options` du volume (correspondant au `PUID`/`PGID` du conteneur), mais l'intégration gcsfuse intégrée de Cloud Run
  substitue silencieusement son propre `uid=2000,gid=2000` — confirmé via la ligne de journal "CLI Flags" de GCSFuse au
  moment du déploiement. Cela n'a eu aucun impact fonctionnel (le montage est resté auto-cohérent
  et inscriptible), mais il est bon de le savoir afin qu'un futur mainteneur ne
  suppose pas que les `mount_options` configurés sont littéralement honorés sur Cloud Run.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Homepage {#a-cloud-run--the-homepage-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence et la répartition du trafic.

### B. Cloud Storage — le volume de configuration {#b-cloud-storage--the-configuration-volume}

Le bucket `storage` est monté à `/app/config` via GCS FUSE. Il contient tous
les fichiers de configuration YAML lus par Homepage (`settings.yaml`, `services.yaml`,
`bookmarks.yaml`, `widgets.yaml`, `docker.yaml`) ainsi que les journaux de Homepage — ce
bucket **est** l'état persistant complet de Homepage ; il n'y a rien d'autre à
sauvegarder.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homepage"
  gcloud storage ls "gs://<bucket-name>/"
  gcloud storage cat "gs://<bucket-name>/settings.yaml"
  ```

### C. Secret Manager {#c-secret-manager}

Rien à voir ici — Homepage ne génère aucun secret. Confirmer cela est
en soi une vérification utile sur un nouveau déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~homepage"
# expect: no results
```

### D. Réseau et ingress {#d-networking--ingress}

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```
  Recherchez la ligne de journal "CLI Flags" de GCSFuse près du démarrage pour confirmer l'UID/GID
  réellement monté (voir §1 ci-dessus — il affichera `uid=2000,gid=2000` sur Cloud
  Run quelle que soit la valeur configurée `mount_options`).

---

## 3. Comportement de l'application Homepage {#3-homepage-application-behaviour}

- **Pas de job de schéma de base de données au premier déploiement.** Homepage n'a pas de base de données, donc
  `initialization_jobs` est vide par défaut et aucun job n'est nécessaire.
- **Pas d'assistant de configuration au premier démarrage.** Il n'y a pas de compte administrateur à créer et pas de
  flux d'intégration — Homepage affiche son tableau de bord à partir de la configuration
  existante dans `/app/config` (les valeurs par défaut intégrées de l'image amont sur un
  nouveau déploiement, puisque le point d'entrée auto-amorce tout fichier manquant).
  Personnalisez le tableau de bord en modifiant directement les fichiers YAML (voir §2B) ou en
  configurant `docker.yaml`/la découverte basée sur les étiquettes si vous le connectez à une
  API Docker/Kubernetes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /api/healthcheck` — un `200 "up"` non authentifié, confirmé en direct.
- **Inspecter l'exécution des jobs (ne devrait rien afficher, par conception) :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### L'option de montage GCS FUSE — à savoir, mais pas à s'inquiéter {#the-gcs-fuse-mount-option-override--worth-knowing-not-worth-worrying-about}

`Homepage_Common` définit explicitement `mount_options` avec `uid=1000,gid=1000` sur
le volume GCS `/app/config`, correspondant aux variables d'environnement `PUID=1000`/`PGID=1000`
du conteneur. Sur un déploiement en direct, la ligne "CLI Flags" de GCSFuse dans Cloud Logging
au démarrage du conteneur montre que le montage *réel* utilise
`uid=2000,gid=2000` — l'intégration gcsfuse intégrée de Cloud Run remplace
la valeur configurée inconditionnellement. Lors des tests, cela n'a eu **aucun impact fonctionnel** :
le montage était auto-cohérent (l'UID/GID remplacé de Cloud Run correspondait à ce que le montage lui-même utilisait pour toutes les écritures ultérieures) et l'application
a démarré et écrit sa configuration proprement. La leçon est plus étroite qu'un bug : ne
supposez pas que l'UID/GID `mount_options` que vous configurez est ce que Cloud Run
utilise littéralement — vérifiez via la ligne de journal si vous déboguez un problème de permissions réel ici.
(Ceci est spécifique à l'intégration gcsfuse de Cloud Run ; le pilote CSI GCS FUSE séparé de GKE n'a pas un tel remplacement et
exige réellement que l'UID/GID configuré corresponde à l'utilisateur du conteneur — voir la découverte gcsfuse de GKE référencée dans le CLAUDE.md de ce dépôt.)

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 100 \
  | grep -i "gcsfuse"
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Homepage sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homepage` | Nom de base des ressources. |
| `application_display_name` | `Homepage` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Transmis directement comme tag d'image `ghcr.io/gethomepage/homepage` — pas d'étape de build. |
| `homepage_allowed_hosts` | `*` | `HOMEPAGE_ALLOWED_HOSTS` — liste blanche d'en-têtes `Host` séparés par des virgules pour les propres appels `/api/*` de Homepage. Pas une véritable limite de contrôle d'accès. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port du serveur autonome Next.js de Homepage. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Léger — le plancher gen2 de 512 Mo est amplement suffisant. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | Les deux directions sont réellement sûres ici — voir §1 ; un cas rare dans ce catalogue où la valeur par défaut large est intentionnelle, pas un espace réservé. |
| `enable_image_mirroring` | `true` | Reflète l'image pré-construite dans Artifact Registry (évite les limites de débit de GHCR) — pas un build. |
| `container_protocol` | `http1` | HTTP/1.1 simple ; pas d'exigence gRPC/h2c. |
| `enable_cloudsql_volume` | `false` | Homepage n'a pas de Cloud SQL — gardez `false`. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le montage du bucket `storage` à `/app/config` est ajouté automatiquement ; utilisez ceci uniquement pour des volumes *supplémentaires*. |
| `enable_nfs` | `false` | Non nécessaire — GCS FUSE à `/app/config` est suffisant pour la charge de travail des fichiers de configuration de Homepage. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Homepage_Common` — Homepage n'a pas de base de données SQL, point final. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Reste vide par défaut — rien à amorcer. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/healthcheck` | `200 "up"` non authentifié — une valeur par défaut précise correspondant à la directive `HEALTHCHECK` de l'image, transmise inchangée depuis `Homepage_Common`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `homepage_url` | Nom du service Cloud Run et URL du tableau de bord (port 3000). |
| `storage_buckets` | Le bucket `storage` supportant `/app/config`. |
| `container_image` / `container_registry` | La référence de l'image déployée et le dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vide pour Homepage). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `gcs_volumes` / stockage à `/app/config` | Laissez le montage automatique `storage` en place | **Critique** | La suppression ou la mauvaise configuration de ce volume entraîne la perte de tous les fichiers de configuration YAML au prochain démarrage à froid — Homepage n'a pas d'autre source de vérité. |
| `HOMEPAGE_ALLOWED_HOSTS` | Laissez `*` à moins que vous ne connaissiez le nom d'hôte final, puis resserrez-le | Moyen | Une valeur trop étroite renvoie des 400 pour chaque widget basé sur l'API (le shell de la page se charge toujours) si le nom d'hôte de la requête réelle ne correspond pas ; le traiter comme une véritable limite d'authentification est un faux sentiment de sécurité de toute façon. |
| Chemin de la sonde | Laissez à `/api/healthcheck` | Élevé | Un chemin de sonde authentifié ou inexistant laisserait la révision en permanence non saine même si l'application a démarré correctement. |
| `enable_redis` | Laissez le `false` codé en dur tel quel (n'essayez pas de le forcer via `environment_variables`) | Faible | Homepage n'a rien à mettre en cache ; l'activation de Redis gaspille une dépendance Memorystore/NFS-Redis sans aucun avantage. |
| UID/GID de montage GCS FUSE supposé | Ne vous fiez pas à ce que le `uid=1000,gid=1000` configuré soit littéral sur Cloud Run | Faible | L'intégration gcsfuse de Cloud Run utilise silencieusement `uid=2000,gid=2000` à la place — inoffensif en pratique, mais une fausse piste si vous déboguez un problème de permissions en lisant le Terraform au lieu de la ligne de journal de montage réelle. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Homepage
est décrite dans **[Homepage_Common](Homepage_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homepage sur Cloud Run](../labs/Homepage_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Homepage sur GKE Autopilot](Homepage_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Homepage Common — Configuration d'application partagée](Homepage_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) dans la solution **Small Business Suite**.
