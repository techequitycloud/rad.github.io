---
title: "Trilium sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Trilium sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Trilium_CloudRun.md @ e69407af sha256:ecc253c2ca0a -->

# Trilium sur Google Cloud Run {#trilium-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_CloudRun.png" alt="Trilium sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (le fork **TriliumNext** activement maintenu — pas le
projet archivé `zadam/trilium`) est une application de prise de notes hiérarchique,
open-source et auto-hébergée, avec une base de données SQLite embarquée. Ce
module déploie Trilium sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Trilium et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Trilium sur RAD, et comment cela se compare {#what-trilium-costs-on-rad-and-how-that-compares}

**L'exécution de Trilium sur Cloud Run dans votre propre projet Google Cloud
coûte environ 32,57 US$/mois en frais Google Cloud**, en plus d'un frais de
module RAD unique de 40 crédits (4 US$) facturé une fois au moment du
déploiement. Trilium conserve tout son état dans une base de données SQLite
embarquée sur un volume NFS partagé, il n'a donc pas besoin de base de données
gérée séparée — son coût de fonctionnement est proche du plancher de ce que
coûte tout déploiement Cloud Run avec stockage persistant. Dans un projet géré
par RAD, les frais de module tombent à 36 crédits (10 % de moins) — voir
[Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous — ou consultez le [guide GKE](Trilium_GKE.md) si vous préférez
l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 40 crédits | 36 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût de fonctionnement Google Cloud | 32,57 US$/mois, facturé par Google au prix catalogue | ~15 crédits/jour (environ 450/mois, 45 US$ au prix de la recharge), mesuré au prix catalogue plus la marge de RAD |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan
mensuel.

**Coût de fonctionnement par défaut dans votre propre projet**

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **32,57 US$** |

### Comment cela se compare {#how-it-compares}

- Trilium (le fork TriliumNext) n'a pas de version cloud hébergée officielle —
  il est distribué uniquement en tant que logiciel auto-hébergé, il n'y a donc
  pas de plan SaaS de fournisseur à comparer.
- Une comparaison auto-gérée, dimensionnée aux valeurs par défaut de Trilium
  (1 vCPU / 1 GiB) : un Hetzner CPX11 ou DigitalOcean 1 vCPU/2 Go Droplet coûte
  environ 6-12 US$/mois, moins cher en espèces que les deux options RAD ici —
  plus votre propre temps pour les sauvegardes, les correctifs du système
  d'exploitation et le renouvellement TLS, que le Secret Manager géré par RAD
  et la surveillance couvrent pour vous.
- Parce que Trilium n'a pas besoin de base de données gérée, l'écart entre RAD
  et un VPS nu est principalement le volume NFS, le réseau et la possibilité de
  le mettre en pause gratuitement dans un projet géré par RAD (voir ci-dessous)
  — et non l'administration de la base de données.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logique récupérable de 30 jours de Google. Contrairement
à la suppression d'un seul module, cela ne démantèle **pas** Cloud SQL,
aucune VM, ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
(moins de 1 US$) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox que la plupart des utilisations d'étude/démo conviennent). Google
indique que la plupart des services sont de nouveau pleinement fonctionnels
dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logique de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant
30 jours. Si vous avez personnalisé Trilium et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du
projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un
projet géré par RAD, il n'y a pas de pause gratuite — la suppression retire les
ressources définitivement, et ramener Trilium signifie redéployer à partir de
zéro. Cela coûte environ 43-46 crédits dans votre propre projet, ou environ
39-42 crédits dans un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si Trilium restait
inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par
rapport à son propre coût de fonctionnement — environ 4 jours ou plus dans
votre propre projet (environ 1,09 US$ par jour), ou environ 3 jours ou plus
dans un projet géré par RAD (15 crédits par jour).

Conservez d'abord les données : les sauvegardes nocturnes vont dans un bucket
à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il
finance, et règle directement avec le client. Si le portefeuille est faible, la
facturation est mise en pause et les données sont conservées, de sorte que
personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Trilium s'exécute comme un conteneur Node.js/Express unique sur Cloud Run v2.
Le déploiement relie un ensemble délibérément restreint de services Google
Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, autoscaling sans serveur — mais voir les notes de mise à l'échelle ci-dessous |
| Base de données | Aucune (SQLite embarquée) | L'intégralité du magasin de documents de Trilium est un seul fichier SQLite, `document.db`, sur le volume persistant |
| Répertoire de données | Cloud Filestore (NFS) | `/home/node/trilium-data` est sur le volume NFS partagé par défaut ; un bucket GCS FUSE y est monté uniquement si NFS est désactivé |
| Secrets | Secret Manager | Aucun généré — Trilium n'a pas de credential piloté par des variables d'environnement |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucun moteur de base de données à gérer.** `database_type = "NONE"` — il n'y a pas
  d'instance Cloud SQL, pas de chaîne de connexion, et rien à sauvegarder
  séparément du bucket de données.
- **Instance unique uniquement.** `min_instance_count = max_instance_count = 1`. La base de données SQLite
  embarquée de Trilium n'a pas de support multi-écriture — l'exécution de plus
  d'une instance risque une corruption de la base de données due à des écritures
  concurrentes.
- **Aucun credential pré-rempli.** Contrairement aux applications avec un mot de
  passe géré par Secret Manager, Trilium n'a **pas** de bootstrap
  d'authentification piloté par des variables d'environnement. Lors de la
  première visite, l'application elle-même présente un écran "Définir le mot de
  passe" ; complétez-le avant de partager l'URL.
- **La sonde de santé est `/api/health-check`, pas `/`.** Le chemin racine
  (`/`) renvoie une redirection 302 vers l'écran de
  configuration/connexion. Seul `/api/health-check` renvoie un `200 {"status":"ok"}` non
  authentifié — confirmé en direct via des tests de conteneur locaux.
- **Le répertoire de données est tout.** `/home/node/trilium-data` contient la base de
  données SQLite, toutes les pièces jointes, l'historique des révisions et les
  paramètres. La perte de ce volume entraîne la perte de tout. Il est sur le
  volume NFS par défaut (`enable_nfs = true`, `nfs_mount_path = /home/node/trilium-data`). Gardez-le là :
  Trilium exécute SQLite en mode WAL, ce qui nécessite un verrouillage de
  mémoire partagée que GCS FUSE ne peut pas fournir, donc sur GCS FUSE les
  écritures récentes sont silencieusement perdues lorsque le conteneur est
  remplacé.
- **`mount_options` défini `uid=1000,gid=1000`** sur le fallback GCS FUSE. Le conteneur de
  Trilium s'exécute en tant qu'utilisateur `node` ; sans options de
  montage correspondantes, GCS FUSE monte le répertoire en tant que root et
  l'application ne démarre pas.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont signalés dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Trilium {#a-cloud-run--the-trilium-service}

Trilium s'exécute comme un service Cloud Run v2 unique. Comme il doit rester à
exactement une instance, il n'y a pas d'autoscaling significatif à observer —
le signal intéressant est la santé de la révision et le comportement de
démarrage à froid.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et le fractionnement du trafic.

### B. Le répertoire de données Trilium {#b-the-trilium-data-directory}

L'état complet de l'application (base de données SQLite `document.db`, pièces
jointes, historique des révisions, paramètres) réside dans `/home/node/trilium-data`, qui
est le chemin de montage NFS par défaut. Un bucket Cloud Storage dédié est
également provisionné ; il est monté à ce chemin via GCS FUSE uniquement
lorsque `enable_nfs = false` ou `nfs_mount_path` pointe ailleurs, de sorte que le
répertoire n'a toujours qu'un seul propriétaire. Évitez ce repli — GCS FUSE ne
peut pas contenir une base de données SQLite en mode WAL en toute sécurité.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et
CMEK.

### C. Réseau et ingress {#c-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Trilium {#3-trilium-application-behaviour}

- **Pas de job de configuration de base de données au premier déploiement.**
  Trilium crée et migre son propre schéma SQLite lors de la première visite
  web, via son propre assistant de configuration — il n'y a pas de job
  `db-init` géré par Terraform à inspecter.
- **Écran "Définir le mot de passe" lors de la première exécution.** La
  navigation vers l'URL racine pour la première fois présente un formulaire de
  configuration de mot de passe (pas d'administrateur/nom d'utilisateur par
  défaut — Trilium est une application mono-utilisateur). Il n'y a pas de
  credential pré-rempli dans Secret Manager à rechercher.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/health-check`, qui renvoie `200 {"status":"ok"}` une fois que le serveur HTTP
  écoute — indépendamment du fait que la base de données SQLite ait été
  initialisée (cela ne se produit qu'après que l'opérateur ait terminé l'étape
  "Définir le mot de passe").
- **Contrainte d'écriture unique.** Ne jamais augmenter `max_instance_count` au-dessus
  de `1` — la base de données SQLite embarquée n'est pas sûre pour
  les écritures concurrentes de plusieurs instances.
- **Inspecter la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Trilium sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `trilium` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Trilium Notes` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image Docker ; mappé à un ARG de build épinglé (`TRILIUM_VERSION`) en interne, non transmis en tant que `latest` au Dockerfile. |
| `enable_password` | `false` | Réservé pour la parité avec d'autres modules d'éditeur mono-utilisateur. **Aucun effet** — Trilium n'a pas de bootstrap de mot de passe piloté par des variables d'environnement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; Trilium est léger, n'augmentez que pour de très grandes collections de notes. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Gardez les deux à 1** — pas de support multi-écriture sur la base de données SQLite embarquée. |
| `container_port` | `8080` | Port HTTP par défaut de Trilium. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Trilium dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut ; restreindre à `internal` pour un déploiement privé. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Trilium. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket de données Trilium. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse supplémentaires au-delà du bucket de données auto-monté. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non référencé — Trilium n'a pas de base de données SQL (SQLite embarquée uniquement). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/health-check`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel sur `/api/health-check`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `trilium_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | L'augmenter risque de corrompre la base de données SQLite embarquée par des écritures concurrentes — il n'y a pas de protection au niveau de la couche de requête contre cela. |
| `enable_nfs` / `nfs_mount_path` | `true` / `/home/node/trilium-data` (les valeurs par défaut) | Critique | Désactiver NFS ou déplacer le montage place `document.db` sur GCS FUSE, où les écritures WAL sont silencieusement perdues lors du remplacement du conteneur. |
| Bucket de données / `gcs_volumes` mount_options (repli GCS FUSE uniquement) | `uid=1000,gid=1000` | Critique | Un uid/gid incorrect monte le répertoire de données en tant que root ; le processus Trilium non-root ne démarre pas avec une erreur de permission. |
| Étape "Définir le mot de passe" lors de la première visite | Terminer immédiatement | Critique | Une instance Trilium sans mot de passe définie, laissée sur une URL publique, est accessible par n'importe qui tant que le mot de passe n'est pas défini. |
| `startup_probe` / `liveness_probe` chemin | `/api/health-check` | Élevé | Pointer les sondes vers `/` entraîne une redirection 302, que la plupart des vérifications de santé HTTP traitent comme un échec, empêchant la révision de devenir prête. |
| `ingress_settings` | `internal` pour usage privé | Moyen | `all` (par défaut) rend l'instance (initialement non authentifiée, avant la définition du mot de passe) accessible depuis l'internet public. |
| `memory_limit` | `1Gi` | Faible | Trilium est léger ; n'augmentez que pour de très grandes collections de notes/pièces jointes. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Trilium partagée avec la variante GKE est décrite
dans **[Trilium_Common](Trilium_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Trilium sur Cloud Run](../labs/Trilium_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de console et les commandes à
  chaque étape.
- [Trilium sur GKE Autopilot](Trilium_GKE.md) — la même application sur
  Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Trilium Common — Configuration d'application partagée](Trilium_Common.md) —
  la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Memos sur Google Cloud Run](Memos_CloudRun.md),
  [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md),
  [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md),
  [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution
  **Connaissances personnelles et lecture**.
