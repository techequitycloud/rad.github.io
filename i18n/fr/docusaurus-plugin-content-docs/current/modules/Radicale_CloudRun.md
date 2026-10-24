---
title: "Radicale sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Radicale sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Radicale_CloudRun.md @ e69407af sha256:2f39c1de8676 -->

# Radicale sur Google Cloud Run {#radicale-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Radicale_CloudRun.png" alt="Radicale sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Radicale est un **serveur CalDAV/CardDAV** auto-hébergé et open-source pour la
synchronisation des calendriers et des contacts — une application WSGI
légère, purement Python, sans framework ni base de données. Il stocke chaque
calendrier et carnet d'adresses sous forme de fichiers iCalendar/vCard
simples sur disque. Ce module déploie Radicale sur **Cloud Run v2** au-dessus
de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Radicale utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que Radicale coûte sur RAD, et comment cela se compare {#what-radicale-costs-on-rad-and-how-that-compares}

**L'exécution de Radicale dans votre propre projet Google Cloud coûte environ 17,58 $ US/mois en infrastructure, plus des frais de module uniques de 40 crédits RAD** (dimensionnés à 1 vCPU / 1 GiB sur une instance Cloud Run à mise à l'échelle à zéro). RAD facture les frais de module une seule fois, au moment du déploiement — jamais plus lors d'une mise à jour — plus le temps de build mesuré en crédits ; l'utilisation de Google Cloud elle-même est facturée à votre propre compte de facturation au prix catalogue de Google. Sur un projet **géré par RAD**, les mêmes ressources sont mesurées à l'heure en crédits au prix catalogue plus la marge de RAD — environ 3 crédits/jour — et les frais de module sont 10 % inférieurs, à 36 crédits. Voir "Mettre en pause gratuitement" ci-dessous pour savoir comment un déploiement Radicale géré par RAD peut être arrêté, sans frais d'exécution, jusqu'à ce que vous en ayez à nouveau besoin. (ou voir le [guide GKE](Radicale_GKE.md) si vous avez besoin de Kubernetes)

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| Article | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 40 crédits (une fois) | 36 crédits (une fois) |
| Temps de build | ~3-6 crédits, mesurés par minute de build | idem, mesurés en crédits au prix catalogue + marge de RAD |
| Coût d'exécution Google Cloud | ~17,58 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~3 crédits/jour, mesurés à l'heure au prix catalogue + marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 |
| Cloud NAT et réseau | 5 |
| Cloud Storage (add-ons, sauvegardes) | 1 |
| **Total** | **17,58 $** |

### Comment cela se compare {#how-it-compares}

- Nous n'avons pas pu vérifier un prix SaaS commercial actuel, directement comparable, pour ce projet open-source exact. La comparaison honnête est donc un serveur auto-géré nu : Hetzner CPX22 (2 vCPU/4 Go, ~24 $/mois), un Droplet DigitalOcean 2 vCPU/4 Go (~24 $/mois), ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois). L'empreinte propre de cette application (1 vCPU ou moins, 1 GiB ou moins) est plus petite que n'importe laquelle de ces classes, donc une machine auto-gérée nue dimensionnée pour correspondre coûterait moins cher que les chiffres ci-dessus — mais vous seriez toujours responsable de chaque correctif, sauvegarde et mise à jour de sécurité.
- RAD ne prétend **pas** battre un VPS nu sur le prix affiché — ce n'est généralement pas le cas. Ce que RAD ajoute pour un montant similaire ou identique est une base de données gérée, des identifiants conservés dans Secret Manager, une surveillance et une mise à jour en un clic, ce qu'un VPS nu ne vous offre pas gratuitement.
- Sur un VPS nu, c'est vous qui appliquez les correctifs de sécurité du système d'exploitation/de la base de données, effectuez et testez les sauvegardes, et renouvelez les certificats ; les services Cloud SQL gérés par RAD, Secret Manager et la surveillance s'occupent des trois pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'option phare d'un projet **géré par RAD**, et elle est gratuite pendant la pause. La suppression
d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet lui-même —
la suppression logique récupérable de 30 jours de Google. Contrairement à la suppression d'un seul module, cela ne démolit
pas la base de données, une VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement,
et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration — dans les 30 jours, et uniquement par le propriétaire du projet — demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les
mêmes ressources déjà présentes : c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les
frais de module à nouveau. L'ensemble de la restauration ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build
pour une chaîne de déploiements typique. Ce qu'il faut : vous devez être propriétaire du projet (pas seulement avoir
RAD qui gère sa facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google
le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démo
conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logique de Cloud Storage explicitement désactivée, de sorte que le bucket de sauvegarde est très probablement supprimé
dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé ce déploiement et souhaitez conserver ce travail, copiez une sauvegarde (vers Google
Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'autre levier, pour un **projet propre** (ou un projet géré par RAD au-delà de sa fenêtre de restauration de 30 jours),
est de supprimer Radicale purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module
plus les builds — environ **43-46 crédits** au total pour ce module.

La suppression ne permet d'économiser de l'argent que si Radicale devait rester inutilisé suffisamment longtemps pour que le coût de redéploiement soit compensé par son propre coût d'exécution — pour ce module, cela représente environ 8 jours ou plus d'inactivité,
basé sur son coût d'exécution de 17,58 $ US/mois mentionné ci-dessus. La majeure partie de ce coût d'exécution est
généralement la base de données et toute VM de fichier/cache partagée, et elles ne s'arrêtent que si rien d'autre dans le
projet ne les utilise. La suppression de cette application seule n'économise donc que sa propre part de calcul si quelque chose d'autre
partage le projet.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec
celui-ci. Copiez donc la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres de RAD et les estimations de crédits quotidiens ; [Resource Manager : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Radicale s'exécute comme un conteneur WSGI Python unique sur Cloud Run v2. Le
déploiement relie un petit ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Processus Python unique, 1 vCPU / 1 GiB par défaut, mise à l'échelle à zéro |
| Base de données | aucune | Radicale stocke chaque collection sous forme de fichiers simples — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est monté à `/var/lib/radicale` via GCS FUSE — la source unique de vérité pour toutes les données |
| Cache et file d'attente | aucun | Radicale n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Un vrai `ADMIN_PASSWORD` généré — Radicale n'est livré avec aucun compte administrateur par défaut |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données d'aucune sorte.** `Radicale_Common` corrige `database_type =
  "NONE"` — Radicale est un pur stockage de système de fichiers.
- **Build personnalisé, avec un wrapper léger.** `Radicale_Common` superpose un point d'entrée cloud
  sur l'image officielle `ghcr.io/kozea/radicale` via Cloud Build, puis
  met en miroir le résultat dans Artifact Registry.
- **Pas de compte administrateur par défaut — un véritable secret généré.** Contrairement aux applications qui
  fournissent un identifiant de première connexion bien connu, l'authentification de Radicale est par défaut
  `denyall` jusqu'à ce qu'elle soit configurée. `Radicale_Common` génère et injecte un véritable
  `ADMIN_PASSWORD` à chaque déploiement (voir le
  [guide commun](Radicale_Common.md)).
- **`max_instance_count` épinglé à `1`, `min_instance_count` par défaut à
  `0`.** Le backend de stockage de Radicale n'est pas conçu pour un accès concurrentiel
  multi-instance, mais n'a pas de base de données/index à réchauffer au démarrage, donc
  la mise à l'échelle à zéro est sûre et rapide.
- **MKCOL est bloqué en périphérie sur Cloud Run — lisez le §3 avant de déployer.**
  La création d'un *nouveau* calendrier/carnet d'adresses nécessite normalement la méthode WebDAV
  `MKCOL`, que le frontend Cloud Run de Google rejette avant même qu'elle n'atteigne
  le conteneur. Un job de seed par défaut contourne ce problème — voir ci-dessous.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Radicale {#a-cloud-run--the-radicale-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence et la répartition du trafic.

### B. Cloud Storage — la source unique de vérité {#b-cloud-storage--the-single-source-of-truth}

Le bucket `storage` est monté à `/var/lib/radicale` via GCS FUSE. Chaque
calendrier, carnet d'adresses, élément et les fichiers htpasswd/config générés y résident — perdre ce bucket, c'est perdre tout l'état de Radicale.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
  gcloud storage ls "gs://<bucket-name>/collections/collection-root/"
  ```

### C. Secret Manager {#c-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~radicale"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
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

---

## 3. Comportement de l'application Radicale {#3-radicale-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init` — Radicale
  n'a pas de base de données à amorcer.
- **`seed-default-collections` s'exécute au moment du déploiement.** Un job d'initialisation unique
  (`execute_on_apply = true`) écrit un "Calendrier par défaut"
  et un "Carnet d'adresses par défaut" directement sur le volume de stockage pour l'utilisateur
  administrateur, contournant entièrement HTTP. Ceci existe en raison d'une véritable
  limitation de la plateforme — voir l'encadré ci-dessous.
- **Pas de compte administrateur par défaut.** L'authentification de Radicale est par défaut `denyall` jusqu'à ce qu'un
  fichier htpasswd existe. `Radicale_Common` génère un véritable
  `ADMIN_PASSWORD` et le point d'entrée cloud écrit à la fois la configuration INI et une
  entrée htpasswd bcrypt **à chaque démarrage** (pas seulement au premier démarrage — il n'y a pas de
  table utilisateur pour vérifier "déjà initialisé").
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — les
  redirections `302` non authentifiées de Radicale vers son interface web, traitées comme saines par les deux
  types de sondes.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### ⚠ MKCOL est bloqué par le frontend de Cloud Run — la chose la plus importante à savoir sur ce module {#-mkcol-is-blocked-by-cloud-runs-frontend--the-most-important-thing-to-know-about-this-module}

La création d'une **nouvelle** collection (calendrier ou carnet d'adresses) via le protocole
CalDAV/CardDAV standard nécessite la méthode HTTP WebDAV `MKCOL`. Confirmé
en direct par un débogage approfondi sur trois tentatives de déploiement distinctes :

- **Le frontend de Cloud Run (GFE) de Google rejette `MKCOL` en périphérie** avec une
  page d'erreur Google générique "400 Bad Request" — la requête n'atteint jamais
  le conteneur Radicale. Toutes les autres méthodes (GET, PUT, PROPFIND) passent
  sans problème ; ceci est spécifique à MKCOL.
- Les services Cloud Run n'ont **pas d'accès shell/exec**, il n'y a donc pas de solution de contournement
  manuelle de l'opérateur après coup.
- Sans correctif, un nouveau déploiement `Radicale_CloudRun` serait incapable de
  créer *aucun* calendrier — ni via un client standard (Apple Calendar,
  Thunderbird, DAVx5), ni même via l'interface web de Radicale, qui
  émet également MKCOL en interne.

**Le correctif :** le job d'initialisation `Radicale_Common` par défaut de `seed-default-collections`
écrit la structure de répertoire de la collection directement sur le volume de stockage —
un conteneur simple avec accès au système de fichiers, sans couche HTTP/GFE impliquée. Ceci
s'exécute automatiquement à chaque déploiement (`execute_on_apply = true`) et amorce un
"Calendrier par défaut" et un "Carnet d'adresses par défaut" pour l'utilisateur administrateur. Vérifié
en direct : un `PROPFIND` sur le principal de l'administrateur liste correctement les deux collections,
et un véritable `VEVENT` peut être `PUT` et `GET` avec succès.

**Si vous avez besoin de collections supplémentaires au-delà des deux par défaut amorcées**, vous
ne pouvez pas les créer via un client standard sur Cloud Run. Soit vous fournissez une entrée
`initialization_jobs` personnalisée qui les écrit de la même manière, soit vous utilisez
`Radicale_GKE`, dont le service LoadBalancer L4 simple n'a aucune restriction MKCOL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Radicale sont listés ; toute autre entrée est
héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `radicale` | Nom de base des ressources. |
| `application_display_name` | `Radicale` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme et la console Cloud Run. |
| `application_version` | `latest` | Se résout en la build épinglée `RADICALE_VERSION=3.7.7` — les tags GHCR n'ont pas de préfixe `v`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5232` | Port natif par défaut de Radicale. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Mise à l'échelle à zéro ; `max` est épinglé à `1` de manière non négociable. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry (évite les limites de débit de GHCR). |
| `container_protocol` | `http1` | Correct — Radicale sert du HTTP/1.1 simple. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Monté à `/var/lib/radicale` via GCS FUSE — la source unique de vérité pour tout l'état de Radicale. |
| `gcs_volumes` | `[]` | Le montage du bucket `storage` est ajouté automatiquement ; utilisez ceci uniquement pour des volumes *supplémentaires*. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Radicale_Common` — Radicale n'a pas de base de données d'aucune sorte. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `seed-default-collections` (injecté par `Radicale_Common`) | Contourne la restriction MKCOL de Cloud Run — voir §3. Fournir une liste personnalisée remplace entièrement cette valeur par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Redirection 302 non authentifiée de Radicale vers son interface web ; les deux types de sondes considèrent 2xx–3xx comme sains. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `radicale_url` | Nom du service Cloud Run et URL interne/publique (note : cette sortie est nommée `radicale_url`, pas `service_url`). |
| `storage_buckets` | Le bucket `storage` supportant `/var/lib/radicale`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (inclut `seed-default-collections`). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| Création de nouvelles collections via un client CalDAV/CardDAV | S'appuyer sur les valeurs par défaut amorcées, ou utiliser `Radicale_GKE` pour des nouvelles collections arbitraires | **Élevé** | `MKCOL` est rejeté en périphérie de Cloud Run (GFE) avant d'atteindre le conteneur — aucun client standard, ni même l'interface web de Radicale, ne peut créer une NOUVELLE collection sur cette plateforme. Seules les deux collections amorcées au moment du déploiement existent, sauf si vous fournissez un job d'initialisation personnalisé. |
| `max_instance_count` | Laisser à `1` | **Critique** | Le backend de stockage de Radicale utilise le verrouillage de fichiers au niveau du système d'exploitation et n'est pas conçu pour un accès multi-instance concurrent ; augmenter cela risque une corruption des données. |
| Identifiant administrateur | Récupérer depuis Secret Manager après le premier déploiement | **Critique** | Contrairement aux applications avec un identifiant par défaut bien connu, Radicale génère un véritable secret — il n'y a aucun moyen de se connecter tant que vous n'avez pas récupéré `ADMIN_PASSWORD`. |
| `stateful_pvc_enabled` (n/a sur Cloud Run) | Utiliser `Radicale_GKE` pour la production | Moyen | Le montage GCS FUSE de Cloud Run a des sémantiques de verrouillage de fichiers plus faibles que ce que le backend de stockage de Radicale attend ; acceptable uniquement parce que la concurrence est limitée à 1 instance. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Radicale
partagée avec la variante GKE est décrite dans
**[Radicale_Common](Radicale_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Radicale sur Cloud Run](../labs/Radicale_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Radicale sur GKE Autopilot](Radicale_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Radicale Common — Configuration d'application partagée](Radicale_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Monica sur Google Cloud Run](Monica_CloudRun.md), [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Organisateur Personnel**.
