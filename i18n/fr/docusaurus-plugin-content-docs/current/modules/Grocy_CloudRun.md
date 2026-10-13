---
title: "Grocy sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Grocy sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Grocy_CloudRun.md @ e69407af sha256:15650ce1d937 -->

# Grocy sur Google Cloud Run {#grocy-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grocy_CloudRun.png" alt="Grocy sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Grocy](https://grocy.info/) est un ERP domestique auto-hébergé pour l'épicerie et la maison :
suivi des stocks avec lecture de codes-barres, gestion des tâches, listes de courses et
planification des repas. Il est distinct du module `Mealie` de ce catalogue, qui ne couvre que la
planification des recettes/repas — Grocy est l'outil ERP domestique plus large. Ce module
déploie Grocy sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée ; `Grocy_CloudRun` est un mince wrapper
qui fournit la propre configuration de Grocy (image, port, sondes, câblage de stockage) et
transmet tout le reste directement.

Ce guide se concentre sur les services cloud utilisés par Grocy et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécaniques communes à toutes les applications Cloud Run — identité de service, ingress et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Grocy sur RAD, et comment cela se compare {#what-grocy-costs-on-rad-and-how-that-compares}

**L'exécution de Grocy sur Cloud Run dans votre propre projet Google Cloud coûte environ 32,57 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une fois au moment du déploiement. Grocy est un ERP domestique léger avec sa propre base de données SQLite intégrée, de sorte que le coût d'exécution de ce déploiement est presque entièrement celui du petit serveur de fichiers NFS derrière lui, et non d'une base de données gérée. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](Grocy_GKE.md) si vous préférez l'exécuter sur Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 32,57 $/mois, facturé par Google au prix catalogue | ~15 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **32,57 $** |

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée : l'empreinte de 1 vCPU/1 GiB de Grocy est suffisamment légère pour une classe de VPS moins chère et plus petite que les boîtiers de milieu de gamme habituellement cités ici — mais pour un point de référence direct, Hetzner CPX22/DigitalOcean 2 vCPU/4 Go coûtent environ 24 $/mois et un GCP e2-standard-2 environ 49 $/mois.
- Grocy n'a pas d'offre SaaS hébergée officielle — il n'est livré qu'en tant que logiciel auto-hébergé, il s'agit donc d'une comparaison VPS vs pile gérée par RAD, et non RAD vs un abonnement.
- Ce qu'un VPS nu ne vous offre pas : sauvegardes automatiques du fichier de données SQLite, rotation des secrets ou surveillance — la pile gérée par RAD couvre ces aspects même si la base de données sous-jacente ici n'est qu'un fichier.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours
de Google. Contrairement à la suppression d'un module, cela ne démantèle **pas** Cloud SQL,
aucune VM, ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement,
et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google
de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter
une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a
été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes —
il s'agit d'une vérification, pas d'une reconstruction, et une mise à jour ne facture plus
jamais les frais de module. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total
pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement
la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le
supprime définitivement — et la restauration est admise comme la création d'un nouveau projet,
donc votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits
pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google
déclare que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures
suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du
projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée,
il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le
projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Grocy et que vous
souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les ressources pour de bon, et ramener Grocy signifie redéployer à partir de zéro. Cela coûte environ 78-81 crédits (les 75 crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si Grocy reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — pour Grocy, c'est environ 8 jours ou plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise un, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Priorité aux données : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Grocy s'exécute comme un conteneur nginx + php-fpm (l'image LinuxServer.io `grocy`
en amont, non modifiée) sur Cloud Run v2. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | 1 vCPU / 1 GiB par défaut, `min=max=1` (pas d'autoscaling — SQLite mono-écriture) |
| Base de données | Aucune | Grocy utilise une base de données SQLite intégrée — aucune instance Cloud SQL n'est créée |
| État persistant | Cloud Filestore (NFS) | `/config` (base de données SQLite, configuration, téléchargements, sauvegardes) est monté via NFS, **pas** GCS FUSE — voir §4 |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné mais inutilisé par défaut (voir §4) |
| Secrets | Secret Manager | Aucun généré pour Grocy — aucune information d'identification d'administrateur injectable n'existe |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge par Grocy.** Confirmé par la lecture du
  code source de Grocy (`services/DatabaseService.php`) — il n'y a aucune branche de pilote MySQL/Postgres.
  `database_type` est fixé à `NONE`.
- **`/config` est persisté via NFS, pas GCS FUSE — une correction délibérée, pas la
  valeur par défaut habituelle du catalogue.** Grocy écrit sur `data/grocy.db-journal` toutes les 1 à 2
  secondes ; la couche de traduction de stockage d'objets de GCS FUSE ne peut pas supporter ce
  modèle d'écriture. Un `/config` basé sur GCS-FUSE a bouclé en production (confirmé en direct
  sur 12 cycles de démarrage / 20+ minutes — `BufferedWriteHandler.OutOfOrderError` répétés,
  limitation de débit HTTP `429`, erreurs de descripteur de fichier périmé). `Grocy_CloudRun`
  définit plutôt `enable_nfs = true`, `nfs_mount_path = "/config"`. Voir §4 pour l'histoire complète.
- **Il s'agit d'une classe de bugs véritablement différente de l'incident SQLite-on-NFS
  d'UptimeKuma.** Le problème d'UptimeKuma était une incompatibilité de verrouillage en mode WAL.
  Grocy n'active jamais le mode WAL (pas de PRAGMA `journal_mode` nulle part dans son code source) —
  son problème est la *fréquence* d'écriture, pas la sémantique de verrouillage. Ensemble, ils
  montrent que "gcsfuse casse SQLite" est une leçon plus large que le simple verrouillage WAL.
- **Une seule instance.** `min_instance_count = 1`, `max_instance_count = 1`. La base de données SQLite de Grocy est
  mono-écriture sans prise en charge du clustering — l'exécution de plusieurs réplicas sur le
  même volume est dangereuse.
- **Aucune information d'identification d'administrateur injectable.** L'image en amont fournit
  des informations d'identification par défaut `admin` / `admin`, modifiables via l'interface
  utilisateur web lors de la première connexion. Aucun secret Secret Manager n'est créé pour Grocy.
- **Les sondes de santé atteignent `/`, pas `/health`.** Grocy n'a pas de point de terminaison
  de santé dédié ; la page de connexion (`200`, non authentifiée) est utilisée pour les
  sondes de démarrage et de vivacité.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de
ressource sont indiqués dans les [Sorties](#6-outputs) du déploiement.

### A. Cloud Run — le service Grocy {#a-cloud-run--the-grocy-service}

Grocy s'exécute comme un service Cloud Run v2 à instance unique. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements
sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud Filestore (NFS) — le volume `/config` {#b-cloud-filestore-nfs--the-config-volume}

Tout l'état de Grocy — la base de données SQLite intégrée (`grocy.db`), `config.php`,
les images/pièces jointes téléchargées et les sauvegardes — se trouve sous `/config`, monté
sur une instance Cloud Filestore (NFS) plutôt que GCS FUSE. C'est la décision de stockage
portante pour ce module (voir §4) ; la perte ou la mauvaise configuration de ce montage
entraîne la perte de toutes les données Grocy.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT" --zone "$REGION-a"
  gcloud filestore instances describe <instance-name> --project "$PROJECT" --zone "$REGION-a"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la découverte automatique et le comportement de
provisionnement NFS.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `storage` dédié est provisionné automatiquement, mais par
défaut, il n'est **pas** utilisé pour sauvegarder `/config` — ce montage passe par NFS
à la place (voir §4). Il reste disponible pour tout `gcs_volumes` personnalisé qu'un
opérateur ajoute.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ;
les paramètres d'ingress et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont
envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques
d'alerte facultatives.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Grocy {#3-grocy-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Grocy n'a pas de base de
  données externe et pas de job `db-init` — il crée et migre son propre schéma SQLite
  intégré sous `/config` au premier démarrage.
- **La durabilité de `/config` dépend du montage NFS, pas d'une base de données gérée.**
  Parce que tout l'état de Grocy (base de données, configuration, téléchargements, sauvegardes)
  se trouve dans des fichiers sur `/config`, la correction du montage NFS *est* la
  correction du déploiement. Confirmez que le montage est sain avant de faire confiance à
  toute donnée qui y est écrite.
- **Aucune information d'identification d'administrateur n'est générée ou injectable.** L'image
  en amont fournit des informations d'identification par défaut `admin` / `admin`.
  Connectez-vous avec celles-ci lors du premier accès et changez le mot de passe immédiatement
  via Utilisateurs → admin → Modifier dans l'interface utilisateur de Grocy — il n'y a pas de
  variable d'environnement ou de valeur Secret Manager qui le définisse pour vous.
- **Chemin de santé.** Les sondes de démarrage et de vivacité émettent toutes deux des requêtes
  HTTP `GET /`, qui renvoient la page de connexion de Grocy (`200`) sans
  authentification requise. Ce n'est pas un point de terminaison de santé dédié — Grocy n'en
  a pas — mais cela indique de manière fiable que la pile nginx + php-fpm fonctionne.
- **La contrainte d'écriture unique est architecturale, pas un paramètre de mise à l'échelle.**
  Parce que la base de données SQLite de Grocy n'a pas d'équivalent MySQL/Postgres et pas de
  prise en charge du clustering, `max_instance_count` doit rester à `1`. Il n'y a
  aucune configuration qui permette une mise à l'échelle horizontale en toute sécurité pour ce
  module.
- **Vérifié en direct.** `https://grocycr31ffe08b-kj6qcu2rxa-uc.a.run.app` — 16 échantillons curl sur ~5 minutes
  contre une seule révision stable (`grocycr31ffe08b-00003-h4w`), servant constamment `<title>Login | Grocy</title>`,
  avec zéro entrée de journal de signature de corruption (`OutOfOrderError` / `429` /
  `stale file` / `database is locked` / `disk I/O error` toutes absentes) après la
  correction NFS décrite au §4.

---

## 4. Pourquoi `/config` utilise NFS au lieu de GCS FUSE — la vraie histoire {#4-why-config-uses-nfs-instead-of-gcs-fuse--the-real-story}

Le câblage de stockage persistant de ce module n'est pas la valeur par défaut habituelle de ce
catalogue, et la raison mérite d'être comprise avant de le modifier.

Grocy écrit sur `data/grocy.db-journal` à chaque transaction de base de données — confirmé en direct,
environ toutes les 1 à 2 secondes en utilisation légère. La couche de traduction de stockage
d'objets de GCS FUSE est construite autour de la cohérence éventuelle, de la sémantique
d'objet entier ; elle ne supporte pas ce type de modèle d'écriture de petite taille à haute
fréquence. `Grocy_CloudRun` montait à l'origine `/config` sur un bucket sauvegardé par GCS-FUSE
— le modèle habituel de ce catalogue pour la configuration d'application persistante — et il
bouclait en production. Confirmé en direct sur 12 cycles de démarrage complets sur plus de 20
minutes, avec de vraies vérifications HTTP ne renvoyant jamais une page fonctionnelle :

- `BufferedWriteHandler.OutOfOrderError` répétés
- Réponses de limitation de débit HTTP `429` de GCS
- Erreurs de descripteur de fichier périmé
- Une boucle de redémarrage-crash permanente

La correction : passer `/config` de GCS FUSE au support de volume **NFS** natif de la
Fondation — `enable_nfs = true`, `nfs_mount_path = "/config"` — avec le propre `Grocy_Common` de
`enable_gcs_storage_volume` défini sur `false` pour éviter un double montage au même chemin. NFS
implémente de vraies sémantiques de fichiers POSIX (renommage/fsync/verrous consultatifs) que
la couche de traduction de GCS FUSE n'implémente pas, et il supporte le modèle d'écriture de
Grocy sans problème.

**Pourquoi il s'agit d'un bug véritablement différent de l'autre incident SQLite-sur-stockage-
partagé du catalogue (UptimeKuma) :** Le problème d'UptimeKuma était une incompatibilité de
**verrouillage en mode WAL** avec NFS. Grocy n'active jamais le mode WAL — il n'y a pas de
PRAGMA `journal_mode` nulle part dans son code source (confirmé par rapport à `DatabaseService.php` en
amont) ; il utilise le mode DELETE/rollback-journal par défaut de SQLite. L'échec de Grocy
sur GCS FUSE n'avait donc rien à voir avec le verrouillage — il s'agissait purement d'un
problème de *fréquence* d'écriture que la sémantique de stockage d'objets de GCS FUSE ne
peut pas absorber. Lues ensemble, la leçon générale s'élargit : **gcsfuse peut casser une
base de données SQLite intégrée pour plus d'une raison** — non seulement le verrouillage en
mode WAL, mais aussi les modèles d'écriture à haute fréquence en général, indépendamment du
mode journal.

Un bug secondaire, sans rapport, a été corrigé en passant lors de la construction de ce module :
une surcharge `container_image_source = "prebuilt"` égarée dans `deploy.tfvars` contournait silencieusement
entièrement la construction Dockerfile personnalisée — la même classe de piège déjà documentée
dans ce catalogue pour UptimeKuma.

**La variante GKE adopte une approche différente du même problème sous-jacent.** `Grocy_GKE`
est échafaudé mais n'a **pas encore été déployé ou vérifié**. Sa correction prévue est un
**PVC de bloc** StatefulSet à `/config` — un véritable stockage de bloc, pas du tout un
système de fichiers réseau — correspondant au modèle général de ce catalogue pour les variantes
GKE d'applications gourmandes en SQLite (par exemple CalibreWeb_GKE). Ce guide sera mis à jour
une fois que cette variante sera déployée et vérifiée.

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Grocy sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grocy` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Grocy` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image LinuxServer. `"latest"` se résout en `v4.6.0-ls333` épinglé (l'ARG de build `GROCY_VERSION`, pas le générique `APP_VERSION`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Grocy est léger ; la valeur par défaut de la mémoire donne de la marge pour les téléchargements d'images/pièces jointes. |
| `min_instance_count` | `1` | Maintient l'instance chaude — évite les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`.** La base de données SQLite de Grocy est mono-écriture sans prise en charge du clustering. |
| `container_port` | `80` | Port HTTP par défaut de Grocy. |
| `container_protocol` | `http1` | Grocy sert du HTTP/1.1 simple ; `h2c` n'est pas requis. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_cloudsql_volume` | `false` | Grocy n'a pas de Cloud SQL — conservez `false`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionné avec les valeurs par défaut de `Grocy_Common` : `PUID=1000`, `PGID=1000`, `TZ=Etc/UTC`. |
| `secret_environment_variables` | `{}` | Aucun secret par défaut n'existe pour Grocy — cette carte est purement fournie par l'opérateur. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Par défaut à `true` pour ce module** — requis pour que `/config` puisse supporter le modèle d'écriture SQLite de Grocy (voir §4). Ne pas désactiver sauf si vous le remplacez par un montage POSIX tout aussi durable. |
| `nfs_mount_path` | `/config` | Grocy conserve tout son état (base de données, configuration, téléchargements, sauvegardes) ici. Ne pas modifier sauf si le chemin de données de l'image en amont change. |
| `create_cloud_storage` | `true` | Le bucket `storage` est toujours créé (inutilisé pour `/config` par défaut ; disponible pour `gcs_volumes` personnalisé). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Grocy n'a pas de base de données SQL de quelque nature que ce soit. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation par défaut — Grocy amorce son propre schéma SQLite au premier démarrage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , 15s de délai, 10 tentatives | Page de connexion de Grocy — aucun point de terminaison de santé dédié n'existe. |
| `liveness_probe` | HTTP `/` , 30s de délai, 3 tentatives | Même point de terminaison que la sonde de démarrage. |

Toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec un comportement
standard.

---

## 6. Sorties {#6-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `grocy_url` | URL de l'interface utilisateur Grocy (port 80). Accessible uniquement au sein du VPC lorsque `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, inutilisé pour `/config` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vides par défaut). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. La plupart des entrées hors limites ou contradictoires sont détectées avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Le désactiver sans un montage POSIX tout aussi durable ramène `/config` à GCS FUSE (ou à un chemin éphémère dans le conteneur), reproduisant la boucle de crash-redémarrage confirmée (`BufferedWriteHandler.OutOfOrderError`, `429`s, erreurs de descripteur de fichier périmé) — ou perdant silencieusement tout l'état à chaque redémarrage. |
| `nfs_mount_path` | `/config` | Critique | Grocy code en dur son chemin de données vers `/config`. Modifier le chemin de montage sans un changement d'image correspondant entraîne la perte d'accès à la base de données, à la configuration et aux téléchargements. |
| `max_instance_count` | `1` | Critique | La base de données SQLite de Grocy est mono-écriture sans prise en charge du clustering. Toute valeur supérieure à `1` risque que des écrivains concurrents corrompent la base de données. |
| `container_image_source` | `custom` (la valeur par défaut du module) | Élevé | Une surcharge `"prebuilt"` égarée contourne silencieusement la construction Dockerfile personnalisée (déjà rencontrée une fois lors de la construction de ce module, et documentée pour UptimeKuma) — Cloud Run pointe alors vers un chemin Artifact Registry non construit. |
| `database_type` | `NONE` | Moyen | Grocy l'ignore entièrement (aucun chemin de code ne le lit), mais définir autre chose provisionne une instance Cloud SQL inutilisée et facturée. |
| Mot de passe administrateur | Changer à la première connexion | Élevé | Les informations d'identification par défaut `admin` / `admin` de l'image en amont sont publiquement documentées ; les laisser inchangées sur un déploiement `ingress_settings = "all"` public est une réelle exposition. |
| `min_instance_count` | `1` | Faible | Définir `0` permet d'économiser des coûts mais réintroduit des démarrages à froid sur la pile nginx + php-fpm de Grocy. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Grocy est
décrite dans **[Grocy_Common](Grocy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Grocy sur Cloud Run](../labs/Grocy_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Grocy sur GKE Autopilot](Grocy_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Grocy Common — Configuration d'application partagée](Grocy_Common.md) — la configuration partagée par les deux cibles de déploiement.
