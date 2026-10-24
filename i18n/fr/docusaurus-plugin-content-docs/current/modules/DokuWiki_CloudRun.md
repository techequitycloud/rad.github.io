---
title: "DokuWiki sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de DokuWiki sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/DokuWiki_CloudRun.md @ e69407af sha256:6e7f0e468d2b -->

# DokuWiki sur Google Cloud Run {#dokuwiki-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DokuWiki_CloudRun.png" alt="DokuWiki sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

DokuWiki est un wiki léger, conforme aux standards, **à fichiers plats** (sans base de données) qui
stocke tout son contenu — pages, médias, plugins, utilisateurs et configuration — sous forme de
fichiers sur disque. Ce module déploie DokuWiki sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud utilisés par DokuWiki et sur la manière de les explorer
et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte DokuWiki sur RAD, et comment cela se compare {#what-dokuwiki-costs-on-rad-and-how-that-compares}

**DokuWiki sur le module Cloud Run de RAD coûte environ 16,78 US$ par mois.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer le système d'exploitation, les correctifs de sécurité et les mises à niveau vous-même. GKE Autopilot convient aux DokuWiki qui doivent rester opérationnels en continu ou s'adapter à plusieurs pods ; pour le coût le plus bas, ce module Cloud Run vous offre déjà l'option la moins chère — consultez le [guide GKE](DokuWiki_GKE.md) si vous avez besoin de l'autre. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — études, démonstration, activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 16,78 US$ deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **16,78 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour**, environ 90 par mois (environ 9 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un forfait mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 16,78 US$** |

### Comment cela se compare {#how-it-compares}

- DokuWiki n'a pas d'édition cloud commerciale officielle à laquelle se comparer — il n'y a pas de fournisseur vendant de l'"hébergement DokuWiki" comme Odoo ou Documenso vendent le leur. La comparaison honnête est un VPS nu : même le niveau le plus petit et le moins cher de Hetzner ou DigitalOcean exécute confortablement un wiki à fichiers plats sans base de données, bien en dessous de la classe de 2 vCPU à ~24 US$/mois que ces fournisseurs citent pour une application plus lourde.
- Ce que vous payez à RAD ici est moins lié à la puissance de calcul brute — DokuWiki est déjà presque gratuit à exécuter — et plus au fait de ne pas avoir à maintenir le système d'exploitation, le certificat TLS et le stockage basé sur GCS vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si DokuWiki s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à un DokuWiki dont vous n'avez besoin qu'occasionnellement — études, démo,
activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à
  la suppression d'un module, cela ne supprime pas Cloud Run ou son bucket de stockage un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 US$)** au total pour une chaîne de déploiement typique de la taille de DokuWiki, contre
  les 40 crédits (4,05 US$) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 16,78 US$.** Déployez DokuWiki, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles DokuWiki était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère
  que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque, et il est plus important ici que pour une application basée sur une base de données.** DokuWiki n'a pas
  de base de données séparée sur laquelle se rabattre — le bucket de stockage contenant vos pages et médias est la
  seule copie. Il n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse
  dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours.
  Copiez le contenu du bucket avant de le supprimer si votre wiki contient des éléments que vous n'avez pas
  copiés ailleurs.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou
une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer
à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 44 crédits
  (4,45 US$), et environ une heure, car RAD recrée le projet et les services partagés avant DokuWiki. La suppression permet d'économiser de l'argent une fois que DokuWiki resterait inutilisé
  pendant environ **8 jours ou plus** dans votre propre projet (environ 0,56 US$ par jour), ou environ
  **14 jours ou plus** dans un projet géré par RAD (3 crédits par jour).
- **Supprimez tout ce que DokuWiki utilise.** DokuWiki n'a pas de base de données ou de VM séparée — son seul coût de fonctionnement est son propre calcul et un peu de réseau — donc le supprimer arrête essentiellement tous ses propres coûts immédiatement.
- **Conservez vos données en premier.** DokuWiki conserve l'intégralité de son wiki — pages, médias, plugins et configuration — dans ce seul bucket de stockage, et le bucket est supprimé avec le déploiement. Copiez son contenu (vers Google Drive, ou un bucket que vous conservez) avant de le supprimer si vous souhaitez conserver votre wiki.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez les
  paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  DokuWiki dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute DokuWiki pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

DokuWiki s'exécute comme un conteneur PHP/Apache sur Cloud Run v2. Le déploiement relie
un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 8080, 1 vCPU / 512 Mio par défaut ; mise à l'échelle à zéro prise en charge |
| Base de données | **Aucune** | DokuWiki est un wiki à fichiers plats — `database_type = "NONE"`, aucune instance Cloud SQL provisionnée |
| Stockage persistant | Cloud Storage (gcsfuse) | Un bucket `gcs-dokuwiki<tenant-prefix>-data` monté à `/storage` contient *tout* l'état du wiki |
| Cache & file d'attente | **Aucun** | Pas de Redis ; DokuWiki n'a pas de modèle file d'attente/travailleur |
| Secrets | **Aucun** | Pas de secrets d'exécution — le compte administrateur est créé via `/install.php` |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** DokuWiki stocke tout dans le répertoire de fichiers plats `/storage`.
  `database_type` est fixé à `"NONE"` ; une garde de validation au moment du plan rejette toute
  autre valeur (elle provisionnerait une instance Cloud SQL inutilisée et entraînerait des coûts).
- **Tout l'état réside dans un seul bucket Cloud Storage.** `/storage` est un montage **gcsfuse**
  du bucket `gcs-dokuwiki<tenant-prefix>-data` auto-provisionné. La suppression ou la redirection de ce bucket
  entraîne la perte de l'intégralité du wiki. `force_destroy` est activé, donc une destruction de module le supprime.
- **Mise en garde sur la persistance avec gcsfuse.** DokuWiki s'appuie sur le verrouillage de fichiers pour les modifications
  concurrentes ; gcsfuse est un stockage d'objets à cohérence éventuelle, pas un système de fichiers POSIX.
  C'est acceptable pour un wiki à faible concurrence, mais une édition simultanée intensive est mieux
  servie par la [variante GKE](DokuWiki_GKE.md), qui utilise un PVC de bloc.
- **La mise à l'échelle à zéro est toujours en vigueur** (`min_instance_count` est codé en dur à `0` dans
  `dokuwiki.tf`, quelle que soit la valeur de la variable). Les démarrages à froid ajoutent quelques secondes à la
  première requête après l'inactivité. `max_instance_count` est par défaut à `1` et doit y rester :
  la sécurité d'édition de DokuWiki dépend des fichiers `.lock`, que le bucket GCS FUSE partagé ne peut
  pas honorer, donc une deuxième instance provoquerait des conflits d'écriture de pages. Mettez à l'échelle verticalement à la place.
- **Facturation basée sur les requêtes par défaut** (`cpu_always_allocated = false`). DokuWiki est un
  wiki purement requête/réponse sans travail de fond en cours de traitement, donc le CPU n'est facturé que
  pendant le traitement d'une requête.
- **Pas de secrets d'exécution.** `secret_environment_variables` est vide par conception ; le
  compte administrateur est créé interactivement lors de la première visite via `/install.php`.
- **Ingress public par défaut** (`ingress_settings = "all"`) afin que le wiki soit accessible
  à son URL `run.app`. Activez IAP pour exiger une connexion Google devant celui-ci.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service DokuWiki {#a-cloud-run--the-dokuwiki-service}

DokuWiki s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dokuwiki"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Base de données — non utilisée {#b-database--not-used}

DokuWiki n'utilise **pas** de base de données. `database_type = "NONE"`, aucune instance Cloud SQL
n'est créée, et aucun job `db-init` ne s'exécute. La garde au moment du plan dans le module rejette toute
valeur `NONE` non-`database_type`. Si vous cherchez où se trouve le contenu du wiki, c'est
le bucket Cloud Storage dans la section C, pas une base de données.

### C. Cloud Storage — le volume de données `/storage` {#c-cloud-storage--the-storage-data-volume}

Un seul bucket **Cloud Storage** (`gcs-dokuwiki<tenant-prefix>-data`) est provisionné automatiquement et
monté à `/storage` à l'intérieur du conteneur via **gcsfuse**. Ce bucket contient *tout*
l'état de DokuWiki : pages, médias, plugins, utilisateurs, ACL et configuration.

- **Console :** Cloud Storage → Buckets → le bucket `gcs-dokuwiki<tenant-prefix>-data`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dokuwiki"
  gcloud storage ls gs://<data-bucket>/                 # bucket name is in the Outputs
  gcloud storage ls -r gs://<data-bucket>/data/pages/   # browse wiki page files
  ```

Les options de montage gcsfuse (`implicit-dirs`, TTL de cache stat/type de 60s) sont définies par
`DokuWiki_Common`. Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis — non utilisé {#d-redis--not-used}

DokuWiki n'a pas de modèle de file d'attente ou de travailleur et n'utilise pas Redis. `enable_redis` est désactivé par
défaut et il n'y a aucune raison de l'activer.

### E. Secret Manager — pas de secrets d'application {#e-secret-manager--no-application-secrets}

DokuWiki n'injecte **aucun** secret d'exécution. Le compte administrateur est créé via l'
installateur de première exécution (`/install.php`) et persisté dans `/storage`, il n'y a donc pas
de clé générée de style `AP_*` à récupérer. `secret_environment_variables` reste vide
par conception. (La fondation peut toujours créer des secrets au niveau de l'infrastructure ; voir
[App_CloudRun](App_CloudRun.md).)

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et de contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs (journaux d'accès/erreurs Apache) sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des stratégies d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application DokuWiki {#3-dokuwiki-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Il n'y a pas de schéma à créer et pas de job `db-init`.
  `initialization_jobs` est vide. Le premier démarrage initialise simplement le volume `/storage` avec
  le wiki par défaut (géré par le point d'entrée de l'image amont) s'il est vide.
- **Configuration initiale via `/install.php`.** Lors de la première visite, ouvrez
  `https://<service-url>/install.php` pour créer le compte administrateur, définir le
  titre du wiki et choisir la politique ACL. Ceci est écrit dans `/storage`. **Supprimez ou
  bloquez `install.php` après** — toute personne y accédant avant que vous ne terminiez la configuration peut
  revendiquer le compte administrateur.
- **Tout l'état est sur `/storage`.** La perte ou la redirection du bucket `gcs-dokuwiki<tenant-prefix>-data`
  entraîne la perte du wiki. Comme le bucket est `force_destroy = true`, une destruction de module
  le supprime — sauvegardez le bucket avant de le supprimer si vous devez conserver le contenu.
- **Pas de migrations automatiques.** La mise à niveau de `application_version` livre un moteur DokuWiki plus récent
  qui lit le même répertoire de données `/storage` ; il n'y a pas d'étape de migration.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent toutes `/` — DokuWiki
  sert sa page de démarrage sans authentification, donc la sonde passe dès que
  Apache est opérationnel. Le premier démarrage se termine en quelques secondes (pas de migrations de base de données).
- **Concurrence.** DokuWiki utilise des verrous de fichiers pour les modifications concurrentes. Sur gcsfuse, c'est
  finalement cohérent, donc maintenez un nombre d'instances modeste et évitez les modifications simultanées intensives ;
  utilisez la [variante GKE](DokuWiki_GKE.md) (PVC de bloc) pour une concurrence d'écriture plus élevée.
- **Inspectez les montages et l'environnement de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='yaml(spec.template.spec.containers[0].volumeMounts, spec.template.spec.volumes)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour DokuWiki sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DokuWiki ; `latest` se résout en une version datée épinglée (`2024-02-06b`) au moment du build. Épinglez une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Gen2 avec CPU toujours actif nécessite ≥ 1 vCPU ; DokuWiki est léger. |
| `memory_limit` | `512Mi` | Mémoire par instance ; DokuWiki nécessite ≥ 256 Mio, 512 Mio recommandés. |
| `min_instance_count` | `0` | Codé en dur à `0` dans `dokuwiki.tf` quelle que soit la valeur de cette variable — DokuWiki se met toujours à l'échelle zéro. |
| `max_instance_count` | `1` | Plafond de coût. Restez modeste — les rédacteurs concurrents sur plusieurs instances se disputent les fichiers gcsfuse partagés. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — DokuWiki n'effectue aucun travail de fond en cours de traitement. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages de volume gcsfuse. |
| `container_port` | `8080` | Apache écoute sur le port 8080. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — laissez à faux. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image DokuWiki dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` expose le wiki publiquement à son URL `run.app`. |
| `enable_iap` | `false` | Exiger une connexion Google devant DokuWiki. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `gcs-dokuwiki<tenant-prefix>-data` supportant `/storage`. |
| `gcs_volumes` | _(valeur par défaut définie par Common)_ | Le montage gcsfuse `/storage`. Laissez tel quel sauf si vous fournissez un volume personnalisé. |
| `enable_nfs` | `false` | DokuWiki est sans état au niveau du conteneur ; NFS non requis. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Une garde au moment du plan rejette toute autre valeur. |

_Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md)._

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut `gcs-dokuwiki<tenant-prefix>-data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide — DokuWiki n'en a pas). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment du plan — IAP sans identités autorisées, un runtime `gen1` avec des montages GCS Fuse, un `backup_retention_days` hors plage, et (spécifique au module) un `NONE` non-`database_type`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| Bucket `gcs-dokuwiki<tenant-prefix>-data` | Ne jamais supprimer/rediriger après le premier déploiement | Critique | Le bucket *est* le wiki — le supprimer ou le rediriger entraîne la perte de toutes les pages, médias et utilisateurs. `force_destroy = true` signifie qu'une destruction de module le supprime ; sauvegardez-le d'abord. |
| `database_type` | `NONE` | Critique | Toute autre valeur échoue à la garde au moment du plan ; si elle est contournée, elle provisionne une instance Cloud SQL inutilisée et des coûts. |
| `install.php` après la configuration | Supprimer / bloquer une fois que l'administrateur existe | Élevé | Quiconque atteint `/install.php` avant que vous ne terminiez la configuration peut revendiquer le compte administrateur. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter le volume gcsfuse `/storage` — le conteneur n'a nulle part où persister les données du wiki. |
| `max_instance_count` | Garder à `1` (la valeur par défaut) | Élevé | Chaque instance monte le même bucket GCS FUSE, qui ne peut pas fournir le verrouillage que les fichiers `.lock` de DokuWiki supposent — les instances concurrentes se disputent les écritures de pages. Mettez à l'échelle avec `cpu_limit` / `memory_limit` à la place. |
| `ingress_settings` | `all` (ou IAP) | Élevé | Laissé public avec des inscriptions/ACL mal configurées, n'importe qui peut modifier ; verrouillez via les ACL dans le wiki et/ou IAP. |
| `memory_limit` | `512Mi` | Moyen | En dessous de 256 Mio, le processus PHP/Apache peut manquer de mémoire sous charge. |
| `min_instance_count` | N/A — codé en dur à `0` | Faible | `dokuwiki.tf` force toujours `min_instance_count = 0` ; définir cette variable à `1` n'a aucun effet. La mise à l'échelle à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après l'inactivité. |
| `application_version` | Épinglez une version datée | Faible | `latest` se résout en un tag épinglé au moment du build, mais l'épinglage explicite rend les mises à niveau délibérées. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à DokuWiki
partagée avec la variante GKE est décrite dans **[DokuWiki_Common](DokuWiki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DokuWiki sur Cloud Run](../labs/DokuWiki_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [DokuWiki sur GKE Autopilot](DokuWiki_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [DokuWiki Common — Configuration d'application partagée](DokuWiki_Common.md) — la configuration partagée par les deux cibles de déploiement.
